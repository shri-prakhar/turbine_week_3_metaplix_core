use anchor_lang::prelude::*;
use mpl_core::{instructions::UpdateV2CpiBuilder, ID as CORE_PROGRAM_ID};

use crate::{error::MPLXCoreError, state::CollectionAuthority};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateNftArgs {
    pub new_name: String,
    pub new_uri: String,
}

#[derive(Accounts)]
pub struct UpdateNft<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    /// CHECK: Validated by MPL Core via UpdateV2 CPI.
    pub asset: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = collection.owner == &CORE_PROGRAM_ID @ MPLXCoreError::InvalidCollection,
        constraint = !collection.data_is_empty() @ MPLXCoreError::CollectionNotInitialized
    )]
    /// CHECK: Validated by Core.
    pub collection: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"collection_authority", collection.key().as_ref()],
        bump = collection_authority.bump
    )]
    pub collection_authority: Account<'info, CollectionAuthority>,
    #[account(address = CORE_PROGRAM_ID)]
    /// CHECK: Constrained to MPL Core program ID.
    pub core_program_id: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> UpdateNft<'info> {
    pub fn update_nft(&mut self, args: UpdateNftArgs) -> Result<()> {
        require!(
            self.authority.key() == self.collection_authority.creator,
            MPLXCoreError::NotAuthorized
        );
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"collection_authority",
            &self.collection.key().to_bytes(),
            &[self.collection_authority.bump],
        ]];

        UpdateV2CpiBuilder::new(&self.core_program_id.to_account_info())
            .asset(&self.asset.to_account_info())
            .collection(Some(&self.collection.to_account_info()))
            .payer(&self.authority.to_account_info())
            .authority(Some(&self.collection_authority.to_account_info()))
            .system_program(&self.system_program.to_account_info())
            .new_name(args.new_name)
            .new_uri(args.new_uri)
            .invoke_signed(signer_seeds)?;

        Ok(())
    }
}
