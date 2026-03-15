use anchor_lang::prelude::*;

declare_id!("4Eek4RvmNAV3N4DYPx1E158b9iZ8cjL5yFScM5eDpXv9");

const SCALE: u128 = 1_000_000_000; // precision scale for avg calc

#[program]
pub mod baby_anchor {
    use super::*;

    pub fn initialize_profile(ctx: Context<InitializeProfile>) -> Result<()> {
        let profile = &mut ctx.accounts.profile;

        profile.owner = ctx.accounts.owner.key();
        profile.total_lamports_in = 0;
        profile.total_token_units_out = 0;
        profile.avg_lamports_per_token_scaled = 0;
        profile.token_units_held = 0;
        profile.realized_pnl_lamports = 0;
        profile.last_update_ts = Clock::get()?.unix_timestamp;
        profile.last_was_disciplined = false;
        profile.disciplined_buy_count = 0;
        profile.buy_count = 0;
        profile.last_improvement_bps = 0;
        


        Ok(())
    }

    pub fn record_buy(
        ctx: Context<RecordBuy>,
        lamports_in: u64,
        token_units_out: u64,
    ) -> Result<()> {
        require!(token_units_out > 0, AcbaError::InvalidTokenAmount);

        let profile = &mut ctx.accounts.profile;

        profile.buy_count = profile
            .buy_count
            .checked_add(1)
            .ok_or(AcbaError::MathOverflow)?;

        let old_avg_scaled = profile.avg_lamports_per_token_scaled;
        let buy_price_scaled = (lamports_in as u128)
            .checked_mul(SCALE)
            .ok_or(AcbaError::MathOverflow)?
            .checked_div(token_units_out as u128)
            .ok_or(AcbaError::MathOverflow)?;

        profile.last_was_disciplined = if profile.total_token_units_out == 0 {
            false
        } else {
            buy_price_scaled <= old_avg_scaled
        };

    if profile.total_token_units_out == 0 {
        profile.last_improvement_bps = 0;
    } else {
        let old_avg_i128 = i128::try_from(old_avg_scaled).map_err(|_| AcbaError::MathOverflow)?;
        let buy_price_i128 = i128::try_from(buy_price_scaled).map_err(|_| AcbaError::MathOverflow)?;

        let diff = old_avg_i128
            .checked_sub(buy_price_i128)
            .ok_or(AcbaError::MathOverflow)?;

        let scaled_diff = diff
            .checked_mul(10_000)
            .ok_or(AcbaError::MathOverflow)?;

        let improvement_bps = scaled_diff
            .checked_div(old_avg_i128)
            .ok_or(AcbaError::MathOverflow)?;

        profile.last_improvement_bps =
            i64::try_from(improvement_bps).map_err(|_| AcbaError::MathOverflow)?;

        }

        if profile.last_was_disciplined {
            profile.disciplined_buy_count = profile
                .disciplined_buy_count
                .checked_add(1)
                .ok_or(AcbaError::MathOverflow)?;
        };

        profile.total_lamports_in = profile
            .total_lamports_in
            .checked_add(lamports_in)
            .ok_or(AcbaError::MathOverflow)?;

        profile.total_token_units_out = profile
            .total_token_units_out
            .checked_add(token_units_out)
            .ok_or(AcbaError::MathOverflow)?;

        profile.token_units_held = profile
            .token_units_held
            .checked_add(token_units_out)
            .ok_or(AcbaError::MathOverflow)?;

        let total_lamports_u128 = profile.total_lamports_in as u128;
        let total_tokens_u128 = profile.total_token_units_out as u128;

        profile.avg_lamports_per_token_scaled = total_lamports_u128
            .checked_mul(SCALE)
            .ok_or(AcbaError::MathOverflow)?
            .checked_div(total_tokens_u128)
            .ok_or(AcbaError::MathOverflow)?;

        profile.last_update_ts = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn record_sell(
        ctx: Context<RecordSell>,
        lamports_out: u64,
        token_units_sold: u64,
    ) -> Result<()> {
        require!(token_units_sold > 0, AcbaError::InvalidTokenAmount);

        let profile = &mut ctx.accounts.profile;

        require!(
            profile.token_units_held >= token_units_sold,
            AcbaError::InsufficientHeld
        );

        let sold_u128 = token_units_sold as u128;

        let cost_basis_u128 = sold_u128
            .checked_mul(profile.avg_lamports_per_token_scaled)
            .ok_or(AcbaError::MathOverflow)?
            .checked_div(SCALE)
            .ok_or(AcbaError::MathOverflow)?;

        let cost_basis_i128: i128 = cost_basis_u128
            .try_into()
            .map_err(|_| AcbaError::MathOverflow)?;

        let proceeds_i128 = lamports_out as i128;

        let pnl = proceeds_i128
            .checked_sub(cost_basis_i128)
            .ok_or(AcbaError::MathOverflow)?;

        profile.realized_pnl_lamports = profile
            .realized_pnl_lamports
            .checked_add(pnl)
            .ok_or(AcbaError::MathOverflow)?;

        profile.token_units_held = profile
            .token_units_held
            .checked_sub(token_units_sold)
            .ok_or(AcbaError::MathOverflow)?;

        profile.last_update_ts = Clock::get()?.unix_timestamp;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeProfile<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + AcbaProfile::INIT_SPACE,
        seeds = [b"acba", owner.key().as_ref()],
        bump
    )]
    pub profile: Account<'info, AcbaProfile>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordBuy<'info> {
    #[account(
        mut,
        seeds = [b"acba", owner.key().as_ref()],
        bump,
        has_one = owner
    )]
    pub profile: Account<'info, AcbaProfile>,

    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct RecordSell<'info> {
    #[account(
        mut,
        seeds = [b"acba", owner.key().as_ref()],
        bump,
        has_one = owner
    )]
    pub profile: Account<'info, AcbaProfile>,

    pub owner: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct AcbaProfile {
    pub owner: Pubkey,                      // 32
    pub total_lamports_in: u64,              // 8
    pub total_token_units_out: u64,          // 8
    pub avg_lamports_per_token_scaled: u128, // 16
    pub token_units_held: u64,               // 8
    pub realized_pnl_lamports: i128,         // 16
    pub last_update_ts: i64,                 // 8
    pub last_was_disciplined: bool,          // 1
    pub disciplined_buy_count: u64,          // 8
    pub buy_count: u64,                     // 8
    pub last_improvement_bps: i64,          // 8
}

impl AcbaProfile {
    pub const INIT_SPACE: usize = 128; // updated for new i64 field
}

#[error_code]
pub enum AcbaError {
    #[msg("Token amount must be > 0")]
    InvalidTokenAmount,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Not enough tokens held to sell")]
    InsufficientHeld,
}