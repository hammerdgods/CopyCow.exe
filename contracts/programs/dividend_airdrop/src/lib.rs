//! # COPYCOW MONEY CONTRACT — creator-reward split + holder airdrops
//!
//! Plain-English summary:
//! * $COPYCOW's pump.fun creator rewards land in COWBOT's wallet. COWBOT calls
//!   `route_creator_rewards`: the contract sends 90% straight to the TEAM
//!   WALLET (marketing, untouched by COWBOT) and COWBOT keeps at most 10% as
//!   trading capital. COWBOT cannot change the team wallet.
//! * Creator rewards from coins COWBOT LAUNCHES belong 100% to that coin's
//!   holders: COWBOT deposits them here daily (`deposit_for_holders`, kind
//!   LaunchedCoinRewards) and they're airdropped to that coin's holders.
//! * All of COWBOT's PROFIT (trading + selling its launch buys) is deposited
//!   weekly (kind CowbotProfit) and airdropped to $COPYCOW holders.
//! * For every airdrop the keeper ("relayer") publishes a Merkle root of every
//!   holder + amount (snapshot at a fixed slot) and PUSHES SOL into each
//!   wallet in batches. Holders never click "claim" and never pay gas.
//! * Every payout can only happen once (bitmap), and the contract can never pay
//!   out more than the vault holds.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_lang::system_program;

declare_id!("DHvKnvryWA3RHUTbX4NCgXwMA7HwM8y7nECXMnpS648X");

// ---------------------------------------------------------------------------
// CREATOR-REWARD SPLIT CONSTANT
// ---------------------------------------------------------------------------
#[constant]
pub const AGENT_SHARE_BPS: u64 = 1000; // 10% — FOUNDER RULE: COWBOT KEEPS MAX 10% OF CREATOR REWARDS, DO NOT CHANGE. Remaining 9000 BPS to the team wallet.
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const TEAM_SHARE_BPS: u64 = BPS_DENOMINATOR - AGENT_SHARE_BPS; // 9000 = 90% → team wallet (marketing, untouched)

// Compile-time guard: the program will not even BUILD if someone raises COWBOT's share above 10%.
const _: () = assert!(AGENT_SHARE_BPS <= 1000, "FOUNDER RULE: COWBOT can never keep more than 10% of creator rewards");

/// One bit per holder in the "already paid" bitmap; 64,000 holders = 8 KB account.
pub const MAX_HOLDERS_PER_EPOCH: u32 = 64_000;
/// Unpaid amounts of an epoch can be released back to the pool after this many epoch lengths.
pub const EPOCH_EXPIRY_MULTIPLIER: i64 = 4;

pub const DISTRIBUTOR_SEED: &[u8] = b"distributor";
pub const VAULT_SEED: &[u8] = b"dividend-vault";
pub const EPOCH_SEED: &[u8] = b"epoch";

/// Splits creator rewards into (COWBOT share, team share). Rounds DOWN for
/// COWBOT, so COWBOT can never keep more than 10%.
pub fn split_creator_rewards(gross_lamports: u64) -> Result<(u64, u64)> {
    let agent = (gross_lamports as u128)
        .checked_mul(AGENT_SHARE_BPS as u128)
        .ok_or(DividendError::MathOverflow)?
        / BPS_DENOMINATOR as u128;
    let agent = agent as u64;
    Ok((agent, gross_lamports - agent))
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

    /// One-time setup. `agent` = COWBOT's wallet, `team_wallet` = where 90% of creator rewards go.
    pub fn initialize(ctx: Context<Initialize>, relayer: Pubkey, copycow_mint: Pubkey, epoch_seconds: i64) -> Result<()> {
        require!(epoch_seconds >= 0, DividendError::InvalidEpochLength);
        let d = &mut ctx.accounts.distributor;
        d.admin = ctx.accounts.admin.key();
        d.agent = ctx.accounts.agent.key();
        d.team_wallet = ctx.accounts.team_wallet.key();
        d.relayer = relayer;
        d.copycow_mint = copycow_mint;
        d.epoch_seconds = epoch_seconds;
        d.current_epoch = 0;
        d.last_distribution_ts = 0;
        d.reserved_lamports = 0;
        d.total_rewards_routed = 0;
        d.total_to_team = 0;
        d.total_profit_deposited = 0;
        d.total_coin_rewards_deposited = 0;
        d.total_distributed = 0;
        d.bump = ctx.bumps.distributor;
        d.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    /// COWBOT reports creator rewards it just claimed from pump.fun. The
    /// contract sends 90% to the team wallet right away; COWBOT keeps max 10%.
    pub fn route_creator_rewards(ctx: Context<RouteCreatorRewards>, gross_lamports: u64) -> Result<()> {
        require!(gross_lamports > 0, DividendError::ZeroAmount);
        let (to_agent, to_team) = split_creator_rewards(gross_lamports)?;
        if to_team > 0 {
            system_program::transfer(
                CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer {
                    from: ctx.accounts.agent.to_account_info(),
                    to: ctx.accounts.team_wallet.to_account_info(),
                }),
                to_team,
            )?;
        }
        let d = &mut ctx.accounts.distributor;
        d.total_rewards_routed = d.total_rewards_routed.checked_add(gross_lamports).ok_or(DividendError::MathOverflow)?;
        d.total_to_team = d.total_to_team.checked_add(to_team).ok_or(DividendError::MathOverflow)?;
        emit!(CreatorRewardsRouted { gross_lamports, to_agent, to_team });
        Ok(())
    }

    /// COWBOT deposits money that belongs to holders: its weekly profit (for
    /// $COPYCOW holders) or a launched coin's creator rewards (for that coin's holders).
    pub fn deposit_for_holders(ctx: Context<DepositForHolders>, amount: u64, kind: AirdropKind, token_mint: Pubkey) -> Result<()> {
        require!(amount > 0, DividendError::ZeroAmount);
        system_program::transfer(
            CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer {
                from: ctx.accounts.agent.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            }),
            amount,
        )?;
        let d = &mut ctx.accounts.distributor;
        match kind {
            AirdropKind::CowbotProfit => {
                d.total_profit_deposited = d.total_profit_deposited.checked_add(amount).ok_or(DividendError::MathOverflow)?
            }
            AirdropKind::LaunchedCoinRewards => {
                d.total_coin_rewards_deposited = d.total_coin_rewards_deposited.checked_add(amount).ok_or(DividendError::MathOverflow)?
            }
        }
        emit!(HolderFundsDeposited { amount, kind, token_mint });
        Ok(())
    }

    /// The keeper publishes the Merkle root for one airdrop: `token_mint` is the
    /// coin whose holders are paid, `kind` says what the money is. The snapshot
    /// slot is the "checkpoint" the holder balances were read at. (Timing —
    /// weekly profit, daily coin rewards — is COWBOT's schedule.)
    pub fn distribute(
        ctx: Context<Distribute>,
        merkle_root: [u8; 32],
        total_lamports: u64,
        holder_count: u32,
        snapshot_slot: u64,
        token_mint: Pubkey,
        kind: AirdropKind,
    ) -> Result<()> {
        require!(total_lamports > 0, DividendError::ZeroAmount);
        require!(holder_count > 0 && holder_count <= MAX_HOLDERS_PER_EPOCH, DividendError::TooManyHolders);
        let now = Clock::get()?.unix_timestamp;
        let d = &mut ctx.accounts.distributor;
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
        e.token_mint = token_mint;
        e.kind = kind;
        e.paid_bitmap = vec![0u8; bitmap_len(holder_count)];

        d.current_epoch = e.index;
        d.last_distribution_ts = now;
        d.reserved_lamports = d.reserved_lamports.checked_add(total_lamports).ok_or(DividendError::MathOverflow)?;
        emit!(EpochPublished { epoch_index: e.index, merkle_root, total_lamports, holder_count, snapshot_slot, token_mint, kind });
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

    /// Only the ADMIN (founder) can change where the team's 90% goes. COWBOT can't.
    pub fn set_team_wallet(ctx: Context<AdminOnly>, new_team_wallet: Pubkey) -> Result<()> {
        ctx.accounts.distributor.team_wallet = new_team_wallet;
        Ok(())
    }
}

fn bitmap_len(holder_count: u32) -> usize {
    (holder_count as usize).div_ceil(8)
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: COWBOT's agent wallet; we only store its address.
    pub agent: UncheckedAccount<'info>,
    /// CHECK: the team wallet that receives 90% of creator rewards; we only store its address.
    pub team_wallet: UncheckedAccount<'info>,
    #[account(init, payer = admin, space = 8 + Distributor::SIZE, seeds = [DISTRIBUTOR_SEED], bump)]
    pub distributor: Account<'info, Distributor>,
    #[account(init, payer = admin, space = 8, seeds = [VAULT_SEED], bump)]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RouteCreatorRewards<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,
    #[account(mut, seeds = [DISTRIBUTOR_SEED], bump = distributor.bump, has_one = agent, has_one = team_wallet)]
    pub distributor: Account<'info, Distributor>,
    /// CHECK: verified against distributor.team_wallet via has_one — COWBOT can't redirect it.
    #[account(mut)]
    pub team_wallet: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositForHolders<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,
    #[account(mut, seeds = [DISTRIBUTOR_SEED], bump = distributor.bump, has_one = agent)]
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
    /// COWBOT's wallet: claims creator rewards, keeps max 10%, deposits weekly profit.
    pub agent: Pubkey,
    /// Receives 90% of all creator rewards (marketing). Only the admin can change it.
    pub team_wallet: Pubkey,
    /// The keeper that publishes roots and pushes payouts.
    pub relayer: Pubkey,
    pub copycow_mint: Pubkey,
    pub epoch_seconds: i64,
    pub current_epoch: u64,
    pub last_distribution_ts: i64,
    /// SOL promised to published-but-not-yet-paid epochs.
    pub reserved_lamports: u64,
    pub total_rewards_routed: u64,
    pub total_to_team: u64,
    pub total_profit_deposited: u64,
    pub total_coin_rewards_deposited: u64,
    pub total_distributed: u64,
    pub bump: u8,
    pub vault_bump: u8,
}
impl Distributor {
    pub const SIZE: usize = 32 * 5 + 8 * 9 + 1 + 1;
}

/// Holds COWBOT's deposited profit until it is airdropped.
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
    /// Whose holders this airdrop pays ($COPYCOW or a launched coin).
    pub token_mint: Pubkey,
    pub kind: AirdropKind,
    /// bit i = 1 once holder i has been paid (prevents double payment)
    pub paid_bitmap: Vec<u8>,
}
impl Epoch {
    pub const BASE_SIZE: usize = 8 + 32 + 8 + 8 + 4 + 4 + 8 + 8 + 1 + 32 + 1 + 4;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Payout {
    pub index: u32,
    pub amount: u64,
    pub proof: Vec<[u8; 32]>,
}

// ---------------------------------------------------------------------------
// Events + errors
// ---------------------------------------------------------------------------

#[event]
pub struct CreatorRewardsRouted {
    pub gross_lamports: u64,
    pub to_agent: u64,
    pub to_team: u64,
}

/// What an airdrop pays out.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum AirdropKind {
    /// COWBOT's trading + launch-sale profit → $COPYCOW holders (weekly).
    CowbotProfit,
    /// A launched coin's creator rewards → that coin's holders (daily).
    LaunchedCoinRewards,
}

#[event]
pub struct HolderFundsDeposited {
    pub amount: u64,
    pub kind: AirdropKind,
    pub token_mint: Pubkey,
}

#[event]
pub struct EpochPublished {
    pub epoch_index: u64,
    pub merkle_root: [u8; 32],
    pub total_lamports: u64,
    pub holder_count: u32,
    pub snapshot_slot: u64,
    pub token_mint: Pubkey,
    pub kind: AirdropKind,
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
    fn founder_rule_cowbot_keeps_at_most_ten_percent() {
        assert_eq!(AGENT_SHARE_BPS, 1000);
        assert_eq!(TEAM_SHARE_BPS, 9000);
        assert_eq!(split_creator_rewards(1_000_000_000).unwrap(), (100_000_000, 900_000_000));
        for gross in [1u64, 9, 10, 11, 999, 123_456_789, u64::MAX] {
            let (agent, team) = split_creator_rewards(gross).unwrap();
            assert_eq!(agent + team, gross);
            assert!((agent as u128) * 10 <= gross as u128, "COWBOT must never keep more than 10%");
        }
    }
}
