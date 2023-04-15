import {
  PublicKey,
  fetchAccount,
  PrivateKey,
  Field,
  Mina,
  AccountUpdate,
} from 'snarkyjs';
import { PriceOracle } from './PriceOracle';

export { loopUntilAccountExists, deploy };

async function loopUntilAccountExists({
  account,
  eachTimeNotExist,
  isZkAppAccount,
}: {
  account: PublicKey;
  eachTimeNotExist: () => void;
  isZkAppAccount: boolean;
}) {
  for (;;) {
    let response = await fetchAccount({ publicKey: account });
    let accountExists = response.account !== undefined;
    if (isZkAppAccount) {
      accountExists = response.account?.zkapp?.appState !== undefined;
    }
    if (!accountExists) {
      eachTimeNotExist();
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } else {
      // TODO add optional check that verification key is correct once this is available in SnarkyJS
      return response.account!;
    }
  }
}

const deployTransactionFee = 100_000_000;

async function deploy(
  deployerPrivateKey: PrivateKey,
  zkAppPrivateKey: PrivateKey,
  zkapp: PriceOracle,
  verificationKey: { data: string; hash: string | Field }
) {
  let sender = deployerPrivateKey.toPublicKey();
  let zkAppPublicKey = zkAppPrivateKey.toPublicKey();
  console.log('using deployer private key with public key', sender.toBase58());
  console.log(
    'using zkApp private key with public key',
    zkAppPublicKey.toBase58()
  );

  let { account } = await fetchAccount({ publicKey: zkAppPublicKey });
  let isDeployed = account?.zkapp?.verificationKey !== undefined;

  if (isDeployed) {
    console.log(
      'zkApp for public key',
      zkAppPublicKey.toBase58(),
      'found deployed'
    );
  } else {
    console.log('Deploying zkapp for public key', zkAppPublicKey.toBase58());
    let transaction = await Mina.transaction(
      { sender, fee: deployTransactionFee },
      () => {
        AccountUpdate.fundNewAccount(sender);
        // NOTE: this calls `init()` if this is the first deploy
        zkapp.deploy({ verificationKey });
      }
    );
    await transaction.prove();
    transaction.sign([deployerPrivateKey, zkAppPrivateKey]);

    console.log('Sending the deploy transaction...');
    const res = await transaction.send();
    const hash = res.hash();
    if (hash === undefined) {
      console.log('error sending transaction (see above)');
    } else {
      console.log(
        'See deploy transaction at',
        'https://berkeley.minaexplorer.com/transaction/' + hash
      );
      console.log('waiting for zkApp account to be deployed...');
      await res.wait();
      isDeployed = true;
    }
  }
  return isDeployed;
}

// ========================================================

interface ToString {
  toString: () => string;
}

type FetchedAccountResponse = Awaited<ReturnType<typeof fetchAccount>>;
type FetchedAccount = NonNullable<FetchedAccountResponse['account']>;

export const makeAndSendTransaction = async <State extends ToString>({
  feePayer,
  feePayerPrivateKey,
  mutateZkApp,
  transactionFee,
  getState,
}: {
  feePayer: PublicKey;
  feePayerPrivateKey: PrivateKey;
  mutateZkApp: () => void;
  transactionFee: number;
  getState: () => State;
  statesEqual: (state1: State, state2: State) => boolean;
}) => {
  const initialState = getState();
  // Why this line? It increments internal feePayer account variables, such as
  // nonce, necessary for successfully sending a transaction
  let account = await fetchAccount({ publicKey: feePayer });

  console.log('Done fetching accounts');
  let transaction = await Mina.transaction(
    { sender: feePayer, fee: transactionFee },
    () => {
      //mutateZkApp();
    }
  );

  // fill in the proof - this can take a while...
  console.log('Creating an execution proof...');
  const time0 = Date.now();
  await transaction.prove();
  const time1 = Date.now();
  console.log('creating proof took', (time1 - time0) / 1e3, 'seconds');

  // sign transaction with the deployer account
  transaction.sign([feePayerPrivateKey]);

  console.log('Sending the transaction...');
  const res = await transaction.send();
  const hash = await res.hash(); // This will change in a future version of SnarkyJS
  if (hash == null) {
    console.log('error sending transaction (see above)');
  } else {
    console.log(
      'See transaction at',
      'https://berkeley.minaexplorer.com/transaction/' + hash
    );
  }
  process.stdout.write('\r\n');
};

// ========================================================

export const zkAppNeedsInitialization = async ({
  zkAppAccount,
}: {
  zkAppAccount: FetchedAccount;
}) => {
  console.warn(
    'warning: using a `utils.ts` written before `isProved` made available. Check https://docs.minaprotocol.com/zkapps/tutorials/deploying-to-a-live-network for updates'
  );
  // TODO when available in the future, use isProved.
  const allZeros = zkAppAccount.zkapp!.appState.every((f: Field) =>
    f.equals(Field.zero).toBoolean()
  );
  const needsInitialization = allZeros;
  return needsInitialization;
};

// ========================================================
