import type { Encoder } from '@solana/codecs';
import {
    addEncoderSizePrefix,
    fixEncoderSize,
    getBooleanEncoder,
    getBytesEncoder,
    getDataEnumCodec,
    getOptionEncoder,
    getUtf8Encoder,
    getStructEncoder,
    getTupleEncoder,
    getU32Encoder,
    getU64Encoder,
    transformEncoder,
    getU16Encoder,
    getU8Encoder,
    getArrayEncoder,
} from '@solana/codecs';
import type { VariableSizeEncoder } from '@solana/codecs';
import type { PublicKey } from '@solana/web3.js';
import { SystemProgram, TransactionInstruction } from '@solana/web3.js';

import type { Field } from './field.js';
import { getFieldCodec, getFieldConfig } from './field.js';

function getInstructionEncoder<T extends object>(discriminator: Uint8Array, dataEncoder: Encoder<T>): Encoder<T> {
    return transformEncoder(getTupleEncoder([getBytesEncoder(), dataEncoder]), (data: T): [Uint8Array, T] => [
        discriminator,
        data,
    ]);
}

function getPublicKeyEncoder(): Encoder<PublicKey> {
    return transformEncoder(fixEncoderSize(getBytesEncoder(), 32), (publicKey: PublicKey) => publicKey.toBytes());
}

function getStringEncoder(): VariableSizeEncoder<string> {
    return addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder());
}

export interface Creator {
    address: PublicKey;
    verified: boolean;
    share: number;
}

export interface Collection {
    key: PublicKey;
    verified: boolean;
}

export interface Uses {
    use_method: number; // 0 = Burn, 1 = Single, 2 = Multiple
    remaining: number;
    total: number;
}

/**
 * Initializes a TLV entry with the basic token-metadata fields.
 *
 * Assumes that the provided mint is an SPL token mint, that the metadata
 * account is allocated and assigned to the program, and that the metadata
 * account has enough lamports to cover the rent-exempt reserve.
 */
interface InitializeInstructionArgs {
    metadata: PublicKey;
    mint: PublicKey;
    mintAuthority: PublicKey;
    name: string;
    programId: PublicKey;
    symbol: string;
    updateAuthority: PublicKey;
    uri: string;
    creators?: Creator[];
    sellerFeeBasisPoints?: number; // Usually 0-10000, representing 0-100%
    collection?: Collection | null;
    uses?: Uses | null;
  }

  export function createInitializeInstruction(args: InitializeInstructionArgs): TransactionInstruction {
    const { 
      programId, 
      metadata, 
      updateAuthority, 
      mint, 
      mintAuthority, 
      name, 
      symbol, 
      uri, 
      creators = [], 
      sellerFeeBasisPoints = 0,
      collection = null,
      uses = null
    } = args;
    
    // Collect any creator keys that need to sign for verification
    const creatorSigners = creators
      .filter(c => c.verified)
      .map(creator => ({
        isSigner: true, 
        isWritable: false, 
        pubkey: creator.address
      }));
      
    // Collection verifier if needed
    const collectionSigners = collection && collection.verified 
      ? [{ isSigner: true, isWritable: false, pubkey: collection.key }] 
      : [];
      
    return new TransactionInstruction({
      programId,
      keys: [
        { isSigner: false, isWritable: true, pubkey: metadata },
        { isSigner: false, isWritable: false, pubkey: updateAuthority },
        { isSigner: false, isWritable: false, pubkey: mint },
        { isSigner: true, isWritable: false, pubkey: mintAuthority },
        ...creatorSigners,
        ...collectionSigners,
      ],
      data: Buffer.from(
        getInstructionEncoder(
          new Uint8Array([
            /* await splDiscriminate('spl_token_metadata_interface:initialize_account') */
            210, 225, 30, 162, 88, 184, 77, 141,
          ]),
          getStructEncoder([
            ['name', getStringEncoder()],
            ['symbol', getStringEncoder()],
            ['uri', getStringEncoder()],
            ['seller_fee_basis_points', getU16Encoder()],
            ['creators', getOptionEncoder(getArrayEncoder(getStructEncoder([
              ['address', getPublicKeyEncoder()],
              ['verified', getBooleanEncoder()],
              ['share', getU8Encoder()],
            ])))],
            ['collection', getOptionEncoder(getStructEncoder([
              ['key', getPublicKeyEncoder()],
              ['verified', getBooleanEncoder()],
            ]))],
            ['uses', getOptionEncoder(getStructEncoder([
              ['use_method', getU8Encoder()],
              ['remaining', getU64Encoder()],
              ['total', getU64Encoder()],
            ]))],
          ]),
        ).encode({ 
          name, 
          symbol, 
          uri, 
          seller_fee_basis_points: sellerFeeBasisPoints,
          creators: creators.length > 0 ? creators : null,
          collection,
          uses
        }),
      ),
    });
  }

/**
 * If the field does not exist on the account, it will be created.
 * If the field does exist, it will be overwritten.
 */
export interface UpdateFieldInstruction {
    programId: PublicKey;
    metadata: PublicKey;
    updateAuthority: PublicKey;
    field: Field | string;
    value: string;
}

export function createUpdateFieldInstruction(args: UpdateFieldInstruction): TransactionInstruction {
    const { programId, metadata, updateAuthority, field, value } = args;
    return new TransactionInstruction({
        programId,
        keys: [
            { isSigner: false, isWritable: true, pubkey: metadata },
            { isSigner: true, isWritable: false, pubkey: updateAuthority },
        ],
        data: Buffer.from(
            getInstructionEncoder(
                new Uint8Array([
                    /* await splDiscriminate('spl_token_metadata_interface:updating_field') */
                    221, 233, 49, 45, 181, 202, 220, 200,
                ]),
                getStructEncoder([
                    ['field', getDataEnumCodec(getFieldCodec())],
                    ['value', getStringEncoder()],
                ]),
            ).encode({ field: getFieldConfig(field), value }),
        ),
    });
}

export interface RemoveKeyInstructionArgs {
    programId: PublicKey;
    metadata: PublicKey;
    updateAuthority: PublicKey;
    key: string;
    idempotent: boolean;
}

export function createRemoveKeyInstruction(args: RemoveKeyInstructionArgs) {
    const { programId, metadata, updateAuthority, key, idempotent } = args;
    return new TransactionInstruction({
        programId,
        keys: [
            { isSigner: false, isWritable: true, pubkey: metadata },
            { isSigner: true, isWritable: false, pubkey: updateAuthority },
        ],
        data: Buffer.from(
            getInstructionEncoder(
                new Uint8Array([
                    /* await splDiscriminate('spl_token_metadata_interface:remove_key_ix') */
                    234, 18, 32, 56, 89, 141, 37, 181,
                ]),
                getStructEncoder([
                    ['idempotent', getBooleanEncoder()],
                    ['key', getStringEncoder()],
                ]),
            ).encode({ idempotent, key }),
        ),
    });
}

export interface UpdateAuthorityInstructionArgs {
    programId: PublicKey;
    metadata: PublicKey;
    oldAuthority: PublicKey;
    newAuthority: PublicKey | null;
}

export function createUpdateAuthorityInstruction(args: UpdateAuthorityInstructionArgs): TransactionInstruction {
    const { programId, metadata, oldAuthority, newAuthority } = args;

    return new TransactionInstruction({
        programId,
        keys: [
            { isSigner: false, isWritable: true, pubkey: metadata },
            { isSigner: true, isWritable: false, pubkey: oldAuthority },
        ],
        data: Buffer.from(
            getInstructionEncoder(
                new Uint8Array([
                    /* await splDiscriminate('spl_token_metadata_interface:update_the_authority') */
                    215, 228, 166, 228, 84, 100, 86, 123,
                ]),
                getStructEncoder([['newAuthority', getPublicKeyEncoder()]]),
            ).encode({ newAuthority: newAuthority ?? SystemProgram.programId }),
        ),
    });
}

export interface EmitInstructionArgs {
    programId: PublicKey;
    metadata: PublicKey;
    start?: bigint;
    end?: bigint;
}

export function createEmitInstruction(args: EmitInstructionArgs): TransactionInstruction {
    const { programId, metadata, start, end } = args;
    return new TransactionInstruction({
        programId,
        keys: [{ isSigner: false, isWritable: false, pubkey: metadata }],
        data: Buffer.from(
            getInstructionEncoder(
                new Uint8Array([
                    /* await splDiscriminate('spl_token_metadata_interface:emitter') */
                    250, 166, 180, 250, 13, 12, 184, 70,
                ]),
                getStructEncoder([
                    ['start', getOptionEncoder(getU64Encoder())],
                    ['end', getOptionEncoder(getU64Encoder())],
                ]),
            ).encode({ start: start ?? null, end: end ?? null }),
        ),
    });
}
