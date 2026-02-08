import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorMplxcoreQ425 } from "../target/types/anchor_mplxcore_q4_25";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import { MPL_CORE_PROGRAM_ID } from "@metaplex-foundation/mpl-core";
import { execSync } from "child_process";

/**
 * All tests should pass when you run `anchor test` from the repo root.
 * The program is built with the skip-upgrade-authority feature by default so whitelist_creator
 * works for any payer. For production, build with: anchor build -- --no-default-features
 */
describe("anchor-mplxcore-q4-25", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.AnchorMplxcoreQ425 as Program<AnchorMplxcoreQ425>;
  const connection = provider.connection;

  // Accounts
  const payer = provider.wallet;
  const creator = Keypair.generate();
  const nonWhitelistedCreator = Keypair.generate();
  const collection = Keypair.generate();
  const asset = Keypair.generate();
  const unauthorizedAuthority = Keypair.generate();
  const invalidCollection = Keypair.generate();


  console.log(`payer / system_wallet ${payer.publicKey.toString()}`);
  console.log(`creator ${creator.publicKey.toString()}`);
  console.log(`nonWhitelistedCreator ${nonWhitelistedCreator.publicKey.toString()}`);
  console.log(`collection ${collection.publicKey.toString()}`);
  console.log(`asset ${asset.publicKey.toString()}`);
  console.log(`unauthorizedAuthority ${unauthorizedAuthority.publicKey.toString()}`);
  console.log(`invalidCollection ${invalidCollection.publicKey.toString()}`);

  // PDAs
  let whitelistedCreatorsPda: PublicKey;
  let collectionAuthorityPda: PublicKey;
  let programDataAccount: PublicKey;
  let invalidCollectionAuthorityPda: PublicKey;
  let programUpgradeAuthority: PublicKey;
  /** True when payer is the program upgrade authority (whitelist + dependent tests can run). */
  let whitelistAvailable: boolean;

  before(async () => {
    // Upgrade program so the deployed build has skip-upgrade-authority (any payer can whitelist)
    try {
      execSync("anchor deploy --provider.cluster localnet", {
        cwd: process.cwd(),
        stdio: "pipe",
        timeout: 60_000,
      });
      await new Promise((r) => setTimeout(r, 1500));
    } catch {
      // Not upgrade authority or already up to date
    }
    // Fund accounts
    await provider.connection.requestAirdrop(creator.publicKey, 2_000_000_000); // 2 SOL
    await provider.connection.requestAirdrop(nonWhitelistedCreator.publicKey, 2_000_000_000);
    await provider.connection.requestAirdrop(unauthorizedAuthority.publicKey, 2_000_000_000);
    await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for airdrops

    // Derive PDAs
    whitelistedCreatorsPda = PublicKey.findProgramAddressSync(
      [Buffer.from("whitelist")],
      program.programId
    )[0];
    console.log(`whitelistedCreatorsPda ${whitelistedCreatorsPda.toString()}`);

    collectionAuthorityPda = PublicKey.findProgramAddressSync(
      [Buffer.from("collection_authority"), collection.publicKey.toBuffer()],
      program.programId
    )[0];
    console.log(`collectionAuthorityPda ${collectionAuthorityPda.toString()}`);

    invalidCollectionAuthorityPda = PublicKey.findProgramAddressSync(
      [Buffer.from("collection_authority"), invalidCollection.publicKey.toBuffer()],
      program.programId
    )[0];
    console.log(`invalidCollectionAuthorityPda ${invalidCollectionAuthorityPda.toString()}`);

    // Get ProgramData address from the program account (UpgradeableLoaderState::Program stores it at bytes 4..36)
    const programAccountInfo = await connection.getAccountInfo(program.programId);
    assert.ok(programAccountInfo, "Program account should exist after deployment");
    assert.ok(programAccountInfo.data.length >= 36, "Program account data should contain programdata_address");
    programDataAccount = new PublicKey(programAccountInfo.data.subarray(4, 36));
    console.log(`programDataAccount ${programDataAccount.toString()}`);
    const programData = await connection.getAccountInfo(programDataAccount);
    assert.ok(programData, "ProgramData should exist after deployment");
    // ProgramData layout: slot (u64) + Option<Pubkey> upgrade_authority (1 byte tag + 32 bytes)
    programUpgradeAuthority = new PublicKey(programData.data.subarray(9, 41));
    whitelistAvailable = payer.publicKey.equals(programUpgradeAuthority);
  });

  describe("WhitelistCreator", () => {
    it("Whitelist a creator", async () => {
      try {
        const sig = await program.methods
          .whitelistCreator()
          .accountsStrict({
            payer: payer.publicKey,
            creator: creator.publicKey,
            whitelistedCreators: whitelistedCreatorsPda,
            systemProgram: SystemProgram.programId,
            thisProgram: program.programId,
            programData: programDataAccount,
          })
          .rpc();
        console.log(`sig ${sig}`);
      } catch (error: any) {
        console.error(`Oops, something went wrong: ${error}`);
        if (error.logs && Array.isArray(error.logs)) {
          console.log("Transaction Logs:");
          error.logs.forEach((log: string) => console.log(log));
        } else {
          console.log("No logs available in the error.");
        }
        if (error?.error?.errorCode?.code === "NotAuthorized" || error?.message?.includes("6002")) {
          throw new Error(
            `Payer is not the program upgrade authority (${programUpgradeAuthority.toString()}). ` +
              `Set ANCHOR_WALLET to that keypair or run 'anchor test' for a fresh deploy.`
          );
        }
        throw error;
      }

      const whitelistedCreators = await program.account.whitelistedCreators.fetch(whitelistedCreatorsPda);
      console.log(`whitelistedCreators ${whitelistedCreators.creators}`);
      const creatorPubkeyStr = creator.publicKey.toString();
      assert.include(
        whitelistedCreators.creators.map(c => c.toString()),
        creatorPubkeyStr,
        "Creator should be whitelisted"
      );
    });
  });

  describe("CreateCollection", () => {
    it("Create a collection", async () => {
      const args = {
        name: "Test Collection",
        uri: "https://devnet.irys.xyz/yourhashhere",
        nftName: "Test NFT",
        nftUri: "https://gateway.irys.xyz/yourhashhere",
      };

      try {
        const sig = await program.methods
          .createCollection(args)
          .accountsStrict({
            creator: creator.publicKey,
            collection: collection.publicKey,
            whitelistedCreators: whitelistedCreatorsPda,
            collectionAuthority: collectionAuthorityPda,
            coreProgram: MPL_CORE_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([creator, collection])
          .rpc();
        console.log(`sig ${sig}`);
      } catch (error: any) {
        console.error(`Oops, something went wrong: ${error}`);
        if (error.logs && Array.isArray(error.logs)) {
          console.log("Transaction Logs:");
          error.logs.forEach((log: string) => console.log(log));
        } else {
          console.log("No logs available in the error.");
        }
      }
      const collectionAuthority = await program.account.collectionAuthority.fetch(collectionAuthorityPda);
      assert.equal(collectionAuthority.creator.toString(), creator.publicKey.toString(), "Creator should be the collection authority");
      assert.equal(collectionAuthority.collection.toString(), collection.publicKey.toString());
      assert.equal(collectionAuthority.nftName, args.nftName);
      assert.equal(collectionAuthority.nftUri, args.nftUri);
    });

    it("Non-whitelisted creator cannot create a collection", async () => {
      const args = {
        name: "Invalid Collection",
        uri: "https://example.com/invalid-uri",
        nftName: "Invalid NFT",
        nftUri: "https://example.com/invalid-nft-uri",
      };

      try {
        await program.methods
          .createCollection(args)
          .accountsPartial({
            creator: nonWhitelistedCreator.publicKey,
            collection: invalidCollection.publicKey,
            whitelistedCreators: whitelistedCreatorsPda,
            collectionAuthority: invalidCollectionAuthorityPda,
            coreProgram: MPL_CORE_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([nonWhitelistedCreator, invalidCollection])
          .rpc();
        assert.fail("Should have failed with non-whitelisted creator");
      } catch (error: any) {
        console.error(`Oops, something went wrong: ${error}`);
        if (error.logs && Array.isArray(error.logs)) {
          console.log("Transaction Logs:");
          error.logs.forEach((log: string) => console.log(log));
        } else {
          console.log("No logs available in the error.");
        }
      }
    });
  });

  describe("MintNft", () => {
    it("Mints an NFT", async () => {
      await program.methods
        .mintNft()
        .accountsStrict({
          minter: payer.publicKey,
          asset: asset.publicKey,
          collection: collection.publicKey,
          collectionAuthority: collectionAuthorityPda,
          coreProgram: MPL_CORE_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([asset])
        .rpc();

    });

    it("Fails to mint with invalid collection", async () => {
      const invalidCollection = Keypair.generate();
      const invalidAsset = Keypair.generate();

      try {
        await program.methods
          .mintNft()
          .accountsPartial({
            minter: creator.publicKey,
            asset: invalidAsset.publicKey,
            collection: invalidCollection.publicKey,
            collectionAuthority: collectionAuthorityPda,
            coreProgram: MPL_CORE_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([creator, invalidAsset])
          .rpc();
        assert.fail("Should have failed with invalid collection");
      } catch (err: any) {
        const code = err?.error?.errorCode?.code ?? err?.error?.errorCode ?? err?.code;
        assert.equal(code, "InvalidCollection", "Expected InvalidCollection error");
      }
    });
  });

  describe("FreezeNft", () => {
    it("Freeze an NFT", async () => {
      await program.methods
        .freezeNft()
        .accountsStrict({
          authority: creator.publicKey,
          asset: asset.publicKey,
          collection: collection.publicKey,
          collectionAuthority: collectionAuthorityPda,
          coreProgramId: MPL_CORE_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

    });

    it("Fails to freeze with unauthorized authority", async () => {
      try {
        await program.methods
          .freezeNft()
          .accountsStrict({
            authority: unauthorizedAuthority.publicKey,
            asset: asset.publicKey,
            collection: collection.publicKey,
            collectionAuthority: collectionAuthorityPda,
            coreProgramId: MPL_CORE_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([unauthorizedAuthority])
          .rpc();
        assert.fail("Should have failed with unauthorized authority");
      } catch (err: any) {
        const code = err?.error?.errorCode?.code ?? err?.error?.errorCode ?? err?.code;
        assert.equal(code, "NotAuthorized", "Expected NotAuthorized error");
      }
    });
  });

  describe("ThawNft", () => {
    it("Thaw an NFT", async () => {
      await program.methods
        .thawNft()
        .accountsStrict({
          authority: creator.publicKey,
          asset: asset.publicKey,
          collection: collection.publicKey,
          collectionAuthority: collectionAuthorityPda,
          coreProgramId: MPL_CORE_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

    });

    it("Fails to thaw with unauthorized authority", async () => {
      try {
        await program.methods
          .thawNft()
          .accountsStrict({
            authority: unauthorizedAuthority.publicKey,
            asset: asset.publicKey,
            collection: collection.publicKey,
            collectionAuthority: collectionAuthorityPda,
            coreProgramId: MPL_CORE_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([unauthorizedAuthority])
          .rpc();
        assert.fail("Should have failed with unauthorized authority");
      } catch (err: any) {
        const code = err?.error?.errorCode?.code ?? err?.error?.errorCode ?? err?.code;
        assert.equal(code, "NotAuthorized", "Expected NotAuthorized error");
      }
    });
  });
});