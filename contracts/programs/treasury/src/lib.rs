//! # TREASURY — the 90% reinvestment pool
//!
//! * Anyone can deposit SOL.
//! * Only the AGENT key can spend, and only within limits enforced on-chain:
//!   - a DAILY spending limit (all purposes combined)
//!   - a TOTAL token-launch budget
//!   - at most ONE token launch per 24 hours
//! * Only the ADMIN (founder) can change the limits or replace the agent key.
//!   Tip: make the admin a multisig (e.g. Squads) before mainnet.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("CMqky8oJFiGcaz2LQerFpiYyPPobzeWPT2iY4KyD7tMw");

pub const SECONDS_PER_DAY: i64 = 86_400;
/// Hard rule mirrored from the off-chain launcher: max 1 launch per 24h.
pub const MIN_SECONDS_BETWEEN_LAUNCHES: i64 = 86_400;

pub const TREASURY_SEED: &[u8] = b"treasury";
pub const TREASURY_VAULT_SEED: &[u8] = b"treasury-vault";

#[program]
pub mod treasury {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, agent: Pubkey, daily_limit_lamports: u64, launch_budget_lamports: u64) -> Result<()> {
        let t = &mut ctx.accounts.treasury;
        t.admin = ctx.accounts.admin.key();
        t.agent = agent;
        t.daily_limit_lamports = daily_limit_lamports;
        t.launch_budget_lamports = launch_budget_lamports;
        t.launch_spent_lamports = 0;
        t.day_start_ts = 0;
        t.spent_today_lamports = 0;
        t.last_launch_ts = 0;
        t.total_spent_lamports = 0;
        t.bump = ctx.bumps.treasury;
        t.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    /// Anyone can top up the treasury.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, TreasuryError::ZeroAmount);
        system_program::transfer(
            CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            }),
            amount,
        )
    }

    /// The agent spends from the treasury — inside the on-chain limits.
    pub fn spend(ctx: Context<Spend>, amount: u64, purpose: SpendPurpose) -> Result<()> {
        require!(amount > 0, TreasuryError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;
        let t = &mut ctx.accounts.treasury;

        // New day window?
        if now - t.day_start_ts >= SECONDS_PER_DAY {
            t.day_start_ts = now;
            t.spent_today_lamports = 0;
        }
        let spent_today = t.spent_today_lamports.checked_add(amount).ok_or(TreasuryError::MathOverflow)?;
        require!(spent_today <= t.daily_limit_lamports, TreasuryError::DailyLimitExceeded);

        if purpose == SpendPurpose::TokenLaunch {
            let launch_spent = t.launch_spent_lamports.checked_add(amount).ok_or(TreasuryError::MathOverflow)?;
            require!(launch_spent <= t.launch_budget_lamports, TreasuryError::LaunchBudgetExceeded);
            require!(
                t.last_launch_ts == 0 || now - t.last_launch_ts >= MIN_SECONDS_BETWEEN_LAUNCHES,
                TreasuryError::LaunchTooSoon
            );
            t.launch_spent_lamports = launch_spent;
            t.last_launch_ts = now;
        }

        let vault = ctx.accounts.vault.to_account_info();
        let rent_min = Rent::get()?.minimum_balance(vault.data_len());
        require!(vault.lamports().saturating_sub(amount) >= rent_min, TreasuryError::InsufficientFunds);

        t.spent_today_lamports = spent_today;
        t.total_spent_lamports = t.total_spent_lamports.checked_add(amount).ok_or(TreasuryError::MathOverflow)?;
        **vault.try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.recipient.try_borrow_mut_lamports()? += amount;
        emit!(TreasurySpend { amount, purpose, recipient: ctx.accounts.recipient.key(), spent_today, ts: now });
        Ok(())
    }

    pub fn update_limits(ctx: Context<AdminOnly>, daily_limit_lamports: u64, launch_budget_lamports: u64) -> Result<()> {
        let t = &mut ctx.accounts.treasury;
        t.daily_limit_lamports = daily_limit_lamports;
        t.launch_budget_lamports = launch_budget_lamports;
        Ok(())
    }

    pub fn set_agent(ctx: Context<AdminOnly>, new_agent: Pubkey) -> Result<()> {
        ctx.accounts.treasury.agent = new_agent;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + TreasuryState::SIZE, seeds = [TREASURY_SEED], bump)]
    pub treasury: Account<'info, TreasuryState>,
    #[account(init, payer = admin, space = 8, seeds = [TREASURY_VAULT_SEED], bump)]
    pub vault: Account<'info, TreasuryVault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Account<'info, TreasuryState>,
    #[account(mut, seeds = [TREASURY_VAULT_SEED], bump = treasury.vault_bump)]
    pub vault: Account<'info, TreasuryVault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Spend<'info> {
    pub agent: Signer<'info>,
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump, has_one = agent)]
    pub treasury: Account<'info, TreasuryState>,
    #[account(mut, seeds = [TREASURY_VAULT_SEED], bump = treasury.vault_bump)]
    pub vault: Account<'info, TreasuryVault>,
    /// CHECK: any account can receive SOL.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump, has_one = admin)]
    pub treasury: Account<'info, TreasuryState>,
}

#[account]
pub struct TreasuryState {
    pub admin: Pubkey,
    pub agent: Pubkey,
    pub daily_limit_lamports: u64,
    pub launch_budget_lamports: u64,
    pub launch_spent_lamports: u64,
    pub day_start_ts: i64,
    pub spent_today_lamports: u64,
    pub last_launch_ts: i64,
    pub total_spent_lamports: u64,
    pub bump: u8,
    pub vault_bump: u8,
}
impl TreasuryState {
    pub const SIZE: usize = 32 * 2 + 8 * 7 + 1 + 1;
}

#[account]
pub struct TreasuryVault {}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum SpendPurpose {
    Trading,
    TokenLaunch,
    Operations,
}

#[event]
pub struct TreasurySpend {
    pub amount: u64,
    pub purpose: SpendPurpose,
    pub recipient: Pubkey,
    pub spent_today: u64,
    pub ts: i64,
}

#[error_code]
pub enum TreasuryError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Daily spending limit exceeded")]
    DailyLimitExceeded,
    #[msg("Token launch budget exceeded")]
    LaunchBudgetExceeded,
    #[msg("Only one token launch per 24 hours")]
    LaunchTooSoon,
    #[msg("Treasury vault has insufficient funds")]
    InsufficientFunds,
}
