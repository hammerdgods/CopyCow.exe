//! # DIVIDEND AIRDROP — the most important contract in copycow.exe
//!
//! Plain-English summary:
//! * Fees come in (pump.fun creator fees + copytrade performance fees).
//! * EXACTLY 10% goes into this contract's vault for $COPYCOW holders;
//!   the other 90% goes to the treasury (the agent wallet).
//! * Once a week the keeper ("relayer") publishes a Merkle root: one small
//!   fingerprint that commits to the full list of (holder wallet, amount)
//!   computed from a token-balance snapshot taken at a fixed slot.
//! * The relayer then PUSHES SOL straight into each holder's wallet in
//!   batches, proving each payment against the root. Holders never click
//!   "claim" and never pay gas — the relayer pays once per batch.
//! * Every payout can only happen once (tracked in a bitmap), and the
//!   contract can never pay out more than the vault holds.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_lang::system_program;

declare_id!("DHvKnvryWA3RHUTbX4NCgXwMA7HwM8y7nECXMnpS648X");

// ---------------------------------------------------------------------------
// FEE SPLIT CONSTANT
// ---------------------------------------------------------------------------
#[constant]
pub const HOLDER_FEE_BPS: u64 = 1000; // 10% — FOUNDER RULE: MAX 10%, DO NOT CHANGE. Remaining 9000 BPS to treasury.
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const TREASURY_FEE_BPS: u64 = BPS_DENOMINATOR - HOLDER_FEE_BPS; // 9000 = 90% → treasury (agent wallet)

// Compile-time guard: the program will not even BUILD if someone raises the holder share above 10%.
const _: () = assert!(HOLDER_FEE_BPS <= 1000, "FOUNDER RULE: holder share can never exceed 10%");

/// One bit per holder in the "already paid" bitmap; 64,000 holders = 8 KB account.
pub const MAX_HOLDERS_PER_EPOCH: u32 = 64_000;
/// Unpaid amounts of an epoch can be released back to the pool after this many epoch lengths.
pub const EPOCH_EXPIRY_MULTIPLIER: i64 = 4;

pub const DISTRIBUTOR_SEED: &[u8] = b"distributor";
pub const VAULT_SEED: &[u8] = b"dividend-vault";
pub const EPOCH_SEED: &[u8] = b"epoch";

/// Splits a gross fee into (holder share, treasury share). Rounds DOWN for
/// holders, so holders can never receive more than 10%.
pub fn split_fee(gross_lamports: u64) -> Result<(u64, u64)> {
    let holders = (gross_lamports as u128)
        .checked_mul(HOLDER_FEE_BPS as u128)
        .ok_or(DividendError::MathOverflow)?
        / BPS_DENOMINATOR as u128;
    let holders = holders as u64;
    Ok((holders, gross_lamports - holders))
}

/// leaf = sha256(0x00 || epoch u64 LE || index u32 LE || wallet || amount u64 LE)
pub fn leaf_hash(epoch_index: u64, index: u32, wallet: &Pubkey, amount: u64) -> [u8; 32] {
    hashv(&[
        &[0u8],
        &epoch_index.to_le_bytes(),
        &index.to_le_bytes(),
        wallet.as_ref(),
        &amount.to_le_bytes(),
    ])
    .to_bytes()
}

/// node = sha256(0x01 || smaller || larger)  (sorted pairs → no left/right flags needed)
pub fn verify_proof(proof: &[[u8; 32]], root: &[u8; 32], leaf: [u8; 32]) -> bool {
    let mut node = leaf;
    for sibling in proof {
        node = if node <= *sibling {
            hashv(&[&[1u8], &node, sibling]).to_bytes()
        } else {
            hashv(&[&[1u8], sibling, &node]).to_bytes()
        };
    }
    node == *root
}

#[program]
pub mod dividend_airdrop {
    use super::*;

    /// One-time setup. `treasury` = where the 90% goes (the agent wallet).
    pub fn initialize(ctx: Context<Initialize>, relayer: Pubkey, copycow_mint: Pubkey, epoch_seconds: i64) -> Result<()> {
        require!(epoch_seconds >= 0, DividendError::InvalidEpochLength);
        let d = &mut ctx.accounts.distributor;
        d.admin = ctx.accounts.admin.key();
        d.treasury = ctx.accounts.treasury.key();
        d.relayer = relayer;
        d.copycow_mint = copycow_mint;
        d.epoch_seconds = epoch_seconds;
        d.current_epoch = 0;
        d.last_distribution_ts = 0;
        d.reserved_lamports = 0;
        d.total_deposited_gross = 0;
        d.total_to_holders = 0;
        d.total_to_treasury = 0;
        d.total_distributed = 0;
        d.bump = ctx.bumps.distributor;
        d.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    /// Anyone can pay fees in: 10% → holder vault, 90% → treasury. Split enforced here, on-chain.
    pub fn deposit_fees(ctx: Context<DepositFees>, gross_lamports: u64, source: FeeSource) -> Result<()> {
        require!(gross_lamports > 0, DividendError::ZeroAmount);
        let (to_holders, to_treasury) = split_fee(gross_lamports)?;
        let sys = ctx.accounts.system_program.to_account_info();
        if to_holders > 0 {
            system_program::transfer(
                CpiContext::new(sys.clone(), system_program::Transfer {
                    from: ctx.accounts.depositor.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                }),
                to_holders,
            )?;
        }
        if to_treasury > 0 {
            system_program::transfer(
                CpiContext::new(sys, system_program::Transfer {
                    from: ctx.accounts.depositor.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                }),
                to_treasury,
            )?;
        }
        record_deposit(&mut ctx.accounts.distributor, gross_lamports, to_holders, to_treasury, source)
    }

    /// The treasury (agent wallet) reports fees it already received (e.g. a
    /// pump.fun creator-fee claim) and sends EXACTLY 10% of them to the vault.
    /// The 90% simply stays in the treasury wallet.
    pub fn deposit_from_treasury(ctx: Context<DepositFromTreasury>, gross_lamports: u64, source: FeeSource) -> Result<()> {
        require!(gross_lamports > 0, DividendError::ZeroAmount);
        let (to_holders, to_treasury) = split_fee(gross_lamports)?;
        if to_holders > 0 {
            system_program::transfer(
                CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer {
                    from: ctx.accounts.treasury.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                }),
                to_holders,
            )?;
        }
        record_deposit(&mut ctx.accounts.distributor, gross_lamports, to_holders, to_treasury, source)
    }

    /// Weekly: the keeper publishes the Merkle root for this epoch's airdrop.
    /// The snapshot slot is the "checkpoint" the holder balances were read at.
    pub fn distribute(
        ctx: Context<Distribute>,
        merkle_root: [u8; 32],
        total_lamports: u64,
        holder_count: u32,
        snapshot_slot: u64,
    ) -> Result<()> {
        require!(total_lamports > 0, DividendError::ZeroAmount);
        require!(holder_count > 0 && holder_count <= MAX_HOLDERS_PER_EPOCH, DividendError::TooManyHolders);
        let now = Clock::get()?.unix_timestamp;
        let d = &mut ctx.accounts.distributor;
        if d.current_epoch > 0 {
            let next = d.last_distribution_ts.checked_add(d.epoch_seconds).ok_or(DividendError::MathOverflow)?;
            require!(now >= next, DividendError::EpochNotOver);
        }
        let vault_info = ctx.accounts.vault.to_account_info();
        let rent_min = Rent::get()?.minimum_balance(vault_info.data_len());
        let available = vault_info
            .lamports()
            .saturating_sub(rent_min)
            .saturating_sub(d.reserved_lamports);
        require!(total_lamports <= available, DividendError::InsufficientVaultBalance);

        let e = &mut ctx.accounts.epoch;
        e.index = d.current_epoch + 1;
        e.merkle_root = merkle_root;
        e.total_lamports = total_lamports;
        e.paid_lamports = 0;
        e.holder_count = holder_count;
        e.paid_count = 0;
        e.snapshot_slot = snapshot_slot;
        e.created_at = now;
        e.bump = ctx.bumps.epoch;
        e.paid_bitmap = vec![0u8; bitmap_len(holder_count)];

        d.current_epoch = e.index;
        d.last_distribution_ts = now;
        d.reserved_lamports = d.reserved_lamports.checked_add(total_lamports).ok_or(DividendError::MathOverflow)?;
        emit!(EpochPublished { epoch_index: e.index, merkle_root, total_lamports, holder_count, snapshot_slot });
        Ok(())
    }

    /// The relayer pushes SOL directly into holders' wallets (no claim button).
    /// `remaining_accounts[i]` must be the wallet for `payouts[i]`.
    pub fn push_payouts<'info>(
        ctx: Context<'_, '_, 'info, 'info, PushPayouts<'info>>,
        epoch_index: u64,
        payouts: Vec<Payout>,
    ) -> Result<()> {
        require!(!payouts.is_empty(), DividendError::ZeroAmount);
        require!(payouts.len() == ctx.remaining_accounts.len(), DividendError::AccountsMismatch);
        let rent = Rent::get()?;
        let vault_info = ctx.accounts.vault.to_account_info();
        let vault_rent_min = rent.minimum_balance(vault_info.data_len());
        let d = &mut ctx.accounts.distributor;
        let e = &mut ctx.accounts.epoch;

        for (p, recipient) in payouts.iter().zip(ctx.remaining_accounts.iter()) {
            require!(recipient.is_writable, DividendError::RecipientNotWritable);
            require!(p.index < e.holder_count, DividendError::InvalidIndex);
            let (byte, bit) = ((p.index / 8) as usize, 1u8 << (p.index % 8));
            require!(e.paid_bitmap[byte] & bit == 0, DividendError::AlreadyPaid);
            let leaf = leaf_hash(epoch_index, p.index, recipient.key, p.amount);
            require!(verify_proof(&p.proof, &e.merkle_root, leaf), DividendError::InvalidProof);
            // A brand-new empty wallet must receive at least the rent minimum.
            if recipient.lamports() == 0 {
                require!(p.amount >= rent.minimum_balance(0), DividendError::PayoutBelowRent);
            }
            let new_paid = e.paid_lamports.checked_add(p.amount).ok_or(DividendError::MathOverflow)?;
            require!(new_paid <= e.total_lamports, DividendError::ExceedsEpochTotal);
            require!(vault_info.lamports().saturating_sub(p.amount) >= vault_rent_min, DividendError::InsufficientVaultBalance);

            e.paid_bitmap[byte] |= bit;
            e.paid_lamports = new_paid;
            e.paid_count += 1;
            d.reserved_lamports = d.reserved_lamports.saturating_sub(p.amount);
            d.total_distributed = d.total_distributed.checked_add(p.amount).ok_or(DividendError::MathOverflow)?;

            **vault_info.try_borrow_mut_lamports()? -= p.amount;
            **recipient.try_borrow_mut_lamports()? += p.amount;
            emit!(PayoutPushed { epoch_index, index: p.index, wallet: recipient.key(), amount: p.amount });
        }
        Ok(())
    }

    /// After an epoch expires, release anything unpaid back into the pool
    /// (it rolls into next week's airdrop) and close the epoch account.
    pub fn close_epoch(ctx: Context<CloseEpoch>, _epoch_index: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let d = &mut ctx.accounts.distributor;
        let e = &ctx.accounts.epoch;
        let all_paid = e.paid_count == e.holder_count;
        let expires = e.created_at + d.epoch_seconds.saturating_mul(EPOCH_EXPIRY_MULTIPLIER);
        require!(all_paid || now >= expires, DividendError::EpochNotExpired);
        let unpaid = e.total_lamports - e.paid_lamports;
        d.reserved_lamports = d.reserved_lamports.saturating_sub(unpaid);
        Ok(())
    }

    pub fn set_relayer(ctx: Context<AdminOnly>, new_relayer: Pubkey) -> Result<()> {
        ctx.accounts.distributor.relayer = new_relayer;
        Ok(())
    }
}

fn bitmap_len(holder_count: u32) -> usize {
    (holder_count as usize).div_ceil(8)
}

fn record_deposit(d: &mut Account<Distributor>, gross: u64, holders: u64, treasury: u64, source: FeeSource) -> Result<()> {
    d.total_deposited_gross = d.total_deposited_gross.checked_add(gross).ok_or(DividendError::MathOverflow)?;
    d.total_to_holders = d.total_to_holders.checked_add(holders).ok_or(DividendError::MathOverflow)?;
    d.total_to_treasury = d.total_to_treasury.checked_add(treasury).ok_or(DividendError::MathOverflow)?;
    emit!(FeesDeposited { gross_lamports: gross, to_holders: holders, to_treasury: treasury, source });
    Ok(())
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: any wallet can be the treasury; we only store its address.
    pub treasury: UncheckedAccount<'info>,
    #[account(init, payer = admin, space = 8 + Distributor::SIZE, seeds = [DISTRIBUTOR_SEED], bump)]
    pub distributor: Account<'info, Distributor>,
    #[account(init, payer = admin, space = 8, seeds = [VAULT_SEED], bump)]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositFees<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(mut, seeds = [DISTRIBUTOR_SEED], bump = distributor.bump, has_one = treasury)]
    pub distributor: Account<'info, Distributor>,
    #[account(mut, seeds = [VAULT_SEED], bump = distributor.vault_bump)]
    pub vault: Account<'info, Vault>,
    /// CHECK: verified against distributor.treasury via has_one.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositFromTreasury<'info> {
    #[account(mut)]
    pub treasury: Signer<'info>,
    #[account(mut, seeds = [DISTRIBUTOR_SEED], bump = distributor.bump, has_one = treasury)]
    pub distributor: Account<'info, Distributor>,
    #[account(mut, seeds = [VAULT_SEED], bump = distributor.vault_bump)]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(merkle_root: [u8; 32], total_lamports: u64, holder_count: u32)]
pub struct Distribute<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,
    #[account(mut, seeds = [DISTRIBUTOR_SEED], bump = distributor.bump, has_one = relayer)]
    pub distributor: Account<'info, Distributor>,
    #[account(seeds = [VAULT_SEED], bump = distributor.vault_bump)]
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        payer = relayer,
        space = 8 + Epoch::BASE_SIZE + bitmap_len(holder_count),
        seeds = [EPOCH_SEED, &(distributor.current_epoch + 1).to_le_bytes()],
        bump
    )]
    pub epoch: Account<'info, Epoch>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(epoch_index: u64)]
pub struct PushPayouts<'info> {
    pub relayer: Signer<'info>,
    #[account(mut, seeds = [DISTRIBUTOR_SEED], bump = distributor.bump, has_one = relayer)]
    pub distributor: Account<'info, Distributor>,
    #[account(mut, seeds = [VAULT_SEED], bump = distributor.vault_bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [EPOCH_SEED, &epoch_index.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
}

#[derive(Accounts)]
#[instruction(epoch_index: u64)]
pub struct CloseEpoch<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,
    #[account(mut, seeds = [DISTRIBUTOR_SEED], bump = distributor.bump, has_one = relayer)]
    pub distributor: Account<'info, Distributor>,
    #[account(mut, close = relayer, seeds = [EPOCH_SEED, &epoch_index.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [DISTRIBUTOR_SEED], bump = distributor.bump, has_one = admin)]
    pub distributor: Account<'info, Distributor>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
pub struct Distributor {
    pub admin: Pubkey,
    /// Where the 90% goes — the agent wallet.
    pub treasury: Pubkey,
    /// The keeper that publishes roots and pushes payouts.
    pub relayer: Pubkey,
    pub copycow_mint: Pubkey,
    pub epoch_seconds: i64,
    pub current_epoch: u64,
    pub last_distribution_ts: i64,
    /// SOL promised to published-but-not-yet-paid epochs.
    pub reserved_lamports: u64,
    pub total_deposited_gross: u64,
    pub total_to_holders: u64,
    pub total_to_treasury: u64,
    pub total_distributed: u64,
    pub bump: u8,
    pub vault_bump: u8,
}
impl Distributor {
    pub const SIZE: usize = 32 * 4 + 8 * 8 + 1 + 1;
}

/// Holds the holders' 10% until it is airdropped.
#[account]
pub struct Vault {}

#[account]
pub struct Epoch {
    pub index: u64,
    pub merkle_root: [u8; 32],
    pub total_lamports: u64,
    pub paid_lamports: u64,
    pub holder_count: u32,
    pub paid_count: u32,
    pub snapshot_slot: u64,
    pub created_at: i64,
    pub bump: u8,
    /// bit i = 1 once holder i has been paid (prevents double payment)
    pub paid_bitmap: Vec<u8>,
}
impl Epoch {
    pub const BASE_SIZE: usize = 8 + 32 + 8 + 8 + 4 + 4 + 8 + 8 + 1 + 4;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Payout {
    pub index: u32,
    pub amount: u64,
    pub proof: Vec<[u8; 32]>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum FeeSource {
    CreatorFee,
    CopytradeFee,
}

// ---------------------------------------------------------------------------
// Events + errors
// ---------------------------------------------------------------------------

#[event]
pub struct FeesDeposited {
    pub gross_lamports: u64,
    pub to_holders: u64,
    pub to_treasury: u64,
    pub source: FeeSource,
}

#[event]
pub struct EpochPublished {
    pub epoch_index: u64,
    pub merkle_root: [u8; 32],
    pub total_lamports: u64,
    pub holder_count: u32,
    pub snapshot_slot: u64,
}

#[event]
pub struct PayoutPushed {
    pub epoch_index: u64,
    pub index: u32,
    pub wallet: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum DividendError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Epoch length cannot be negative")]
    InvalidEpochLength,
    #[msg("Too many (or zero) holders for one epoch")]
    TooManyHolders,
    #[msg("The current epoch is not over yet (weekly schedule)")]
    EpochNotOver,
    #[msg("The vault does not hold enough unreserved SOL")]
    InsufficientVaultBalance,
    #[msg("Number of payouts and recipient accounts differ")]
    AccountsMismatch,
    #[msg("Recipient account must be writable")]
    RecipientNotWritable,
    #[msg("Leaf index out of range")]
    InvalidIndex,
    #[msg("This holder was already paid for this epoch")]
    AlreadyPaid,
    #[msg("Merkle proof does not match the published root")]
    InvalidProof,
    #[msg("Payout to an empty wallet must cover the rent minimum")]
    PayoutBelowRent,
    #[msg("Payouts would exceed the epoch total")]
    ExceedsEpochTotal,
    #[msg("Epoch has not expired yet")]
    EpochNotExpired,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn founder_rule_split_is_exactly_ten_percent() {
        assert_eq!(HOLDER_FEE_BPS, 1000);
        assert_eq!(TREASURY_FEE_BPS, 9000);
        assert_eq!(split_fee(1_000_000_000).unwrap(), (100_000_000, 900_000_000));
        for gross in [1u64, 9, 10, 11, 999, 123_456_789, u64::MAX] {
            let (h, t) = split_fee(gross).unwrap();
            assert_eq!(h + t, gross);
            assert!((h as u128) * 10 <= gross as u128, "holders must never exceed 10%");
        }
    }
}
