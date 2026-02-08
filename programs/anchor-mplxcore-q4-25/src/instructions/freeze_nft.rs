use anchor_lang::prelude::*;
use mpl_core::{
    instructions::UpdatePluginV1CpiBuilder,
    types::{FreezeDelegate, Plugin},
    ID as CORE_PROGRAM_ID,
};

use crate::{error::MPLXCoreError, state::CollectionAuthority};

#[derive(Accounts)]
pub struct FreezeNft<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    /// CHECK: Validated by Core
    pub asset: UncheckedAccount<'info>,
    #[account(
    mut,
    constraint = collection.owner == &CORE_PROGRAM_ID @ MPLXCoreError::InvalidCollection,
    constraint = !collection.data_is_empty() @ MPLXCoreError::CollectionAlreadyInitialized
   )]
    /// CHECK: Validated by Core
    pub collection: UncheckedAccount<'info>,
    #[account(
    mut,
    seeds = [b"collection_authority" , collection.key().as_ref()],
    bump = collection_authority.bump
   )]
    pub collection_authority: Account<'info, CollectionAuthority>,
    #[account(
        address = CORE_PROGRAM_ID
   )]
    /// CHECK: Validated by Address
    pub core_program_id: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> FreezeNft<'info> {
    pub fn freeze_nft(&mut self) -> Result<()> {
        require!(
            self.authority.key() == self.collection_authority.creator,
            MPLXCoreError::NotAuthorized
        );
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"collection_authority",
            &self.collection.key().to_bytes(),
            &[self.collection_authority.bump],
        ]];

        UpdatePluginV1CpiBuilder::new(&self.core_program_id.to_account_info())
            .asset(&self.asset.to_account_info())
            .authority(Some(&self.collection_authority.to_account_info()))
            .plugin(Plugin::FreezeDelegate(FreezeDelegate { frozen: true }))
            .invoke_signed(signer_seeds)?;

        Ok(())
    }
}
