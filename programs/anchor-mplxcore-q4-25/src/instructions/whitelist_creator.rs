use anchor_lang::prelude::*;

use crate::{program::AnchorMplxcoreQ425, state::WhitelistedCreators};

#[cfg(not(feature = "skip-upgrade-authority"))]
use crate::error::MPLXCoreError;

#[derive(Accounts)]
pub struct WhitelistCreator<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK should be a keypair
    pub creator: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = WhitelistedCreators::DISCRIMINATOR.len() + WhitelistedCreators::INIT_SPACE,
        seeds = [b"whitelist"],
        bump,
    )]
    pub whitelisted_creators: Account<'info, WhitelistedCreators>,
    pub system_program: Program<'info, System>,
    #[account(constraint = this_program.programdata_address()? == Some(program_data.key()))]
    pub this_program: Program<'info, AnchorMplxcoreQ425>,
    /// Upgrade authority check is enforced in handler unless `skip-upgrade-authority` feature is enabled (for localnet/tests).
    pub program_data: Account<'info, ProgramData>,
}

impl<'info> WhitelistCreator<'info> {
    pub fn whitelist_creator(&mut self) -> Result<()> {
        #[cfg(not(feature = "skip-upgrade-authority"))]
        require!(
            self.program_data.upgrade_authority_address == Some(self.payer.key()),
            MPLXCoreError::NotAuthorized
        );
        self.whitelisted_creators.whitelist_creator(&self.creator)
    }
}