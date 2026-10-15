//! # TIER ACCESS — "how much $COPYCOW do you hold, and what does that unlock?"
//!
//! * CALF     100K+ tokens → dashboard access + trade alerts
//! * HEIFER    1M+  tokens → real-time Telegram trade alerts
//! * COW      10M+  tokens → auto-copy API key + priority execution
//! * MAD Cow  50M+  tokens → agent config voting + max sizing
//!
//! `get_tier` is a read-only "view" call: apps simulate it (no fee, no
//! signature) and read the returned tier number 0–4. Works with both the
//! classic SPL Token program and Token-2022 (pump.fun uses both).
//! Mirrored in shared/src/tiers.ts — keep the numbers in sync.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey;

declare_id!("GJab9y33RoqsMaaWXWiNVKD1RwY2nWcHRTAJEgt3QMbK");

pub const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_PROGRAM_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// Tier thresholds in WHOLE tokens.
pub const CALF_MIN_TOKENS: u64 = 100_000;
pub const HEIFER_MIN_TOKENS: u64 = 1_000_000;
pub const COW_MIN_TOKENS: u64 = 10_000_000;
pub const MAD_COW_MIN_TOKENS: u64 = 50_000_000;

pub const TIER_NONE: u8 = 0;
pub const TIER_CALF: u8 = 1;
pub const TIER_HEIFER: u8 = 2;
pub const TIER_COW: u8 = 3;
pub const TIER_MAD_COW: u8 = 4;

pub const CONFIG_SEED: &[u8] = b"tier-config";

/// Tier for a raw token amount (`amount` in the mint's smallest units).
pub fn tier_for_amount(amount: u64, decimals: u8) -> u8 {
    let whole = (amount as u128) / 10u128.pow(decimals as u32);
    match whole {
        w if w >= MAD_COW_MIN_TOKENS as u128 => TIER_MAD_COW,
        w if w >= COW_MIN_TOKENS as u128 => TIER_COW,
        w if w >= HEIFER_MIN_TOKENS as u128 => TIER_HEIFER,
        w if w >= CALF_MIN_TOKENS as u128 => TIER_CALF,
        _ => TIER_NONE,
    }
}

fn is_token_program(owner: &Pubkey) -> bool {
    *owner == TOKEN_PROGRAM_ID || *owner == TOKEN_2022_PROGRAM_ID
}

#[program]
pub mod tier_access {
    use super::*;

    /// One-time setup: remember which mint is $COPYCOW (placeholder until launch).
    pub fn initialize(ctx: Context<Initialize>, copycow_mint: Pubkey) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.copycow_mint = copycow_mint;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Point at the real $COPYCOW mint once it launches on pump.fun.
    pub fn set_mint(ctx: Context<SetMint>, copycow_mint: Pubkey) -> Result<()> {
        ctx.accounts.config.copycow_mint = copycow_mint;
        Ok(())
    }

    /// VIEW: returns the tier (0 = none … 4 = MAD Cow) for `owner`, using the
    /// given $COPYCOW token account. A wallet with no token account can pass
    /// any empty account and gets tier 0.
    pub fn get_tier(ctx: Context<GetTier>) -> Result<u8> {
        let mint_info = &ctx.accounts.mint;
        require!(is_token_program(mint_info.owner), TierError::NotATokenAccount);
        let mint_data = mint_info.try_borrow_data()?;
        require!(mint_data.len() >= 82, TierError::NotATokenAccount);
        let decimals = mint_data[44];

        let ta = &ctx.accounts.token_account;
        let (balance, tier) = if ta.data_is_empty() {
            (0u64, TIER_NONE)
        } else {
            require!(is_token_program(ta.owner), TierError::NotATokenAccount);
            let data = ta.try_borrow_data()?;
            require!(data.len() >= 165, TierError::NotATokenAccount);
            let mint = Pubkey::try_from(&data[0..32]).unwrap();
            let owner = Pubkey::try_from(&data[32..64]).unwrap();
            require_keys_eq!(mint, ctx.accounts.config.copycow_mint, TierError::WrongMint);
            require_keys_eq!(owner, ctx.accounts.owner.key(), TierError::WrongOwner);
            let amount = u64::from_le_bytes(data[64..72].try_into().unwrap());
            (amount, tier_for_amount(amount, decimals))
        };
        emit!(TierChecked { owner: ctx.accounts.owner.key(), tier, balance });
        Ok(tier)
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + 32 + 32 + 1, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, TierConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetMint<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, TierConfig>,
}

#[derive(Accounts)]
pub struct GetTier<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, TierConfig>,
    /// CHECK: must be the configured $COPYCOW mint; parsed manually (works for Token + Token-2022).
    #[account(address = config.copycow_mint @ TierError::WrongMint)]
    pub mint: UncheckedAccount<'info>,
    /// CHECK: the holder's $COPYCOW token account (mint + owner verified in the handler).
    pub token_account: UncheckedAccount<'info>,
    /// CHECK: the wallet whose tier we're checking (read-only).
    pub owner: UncheckedAccount<'info>,
}

#[account]
pub struct TierConfig {
    pub admin: Pubkey,
    pub copycow_mint: Pubkey,
    pub bump: u8,
}

#[event]
pub struct TierChecked {
    pub owner: Pubkey,
    pub tier: u8,
    pub balance: u64,
}

#[error_code]
pub enum TierError {
    #[msg("Account is not an SPL token account / mint")]
    NotATokenAccount,
    #[msg("Token account is not for the $COPYCOW mint")]
    WrongMint,
    #[msg("Token account does not belong to this wallet")]
    WrongOwner,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn thresholds() {
        let d = 6u8;
        let t = |whole: u64| tier_for_amount(whole * 1_000_000, d);
        assert_eq!(t(99_999), TIER_NONE);
        assert_eq!(t(100_000), TIER_CALF);
        assert_eq!(t(1_000_000), TIER_HEIFER);
        assert_eq!(t(10_000_000), TIER_COW);
        assert_eq!(t(50_000_000), TIER_MAD_COW);
        assert_eq!(tier_for_amount(u64::MAX, 0), TIER_MAD_COW);
    }
}
