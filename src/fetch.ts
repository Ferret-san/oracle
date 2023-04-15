import { PriceOracle } from './PriceOracle.js';
import {
  isReady,
  shutdown,
  Mina,
  Field,
  PrivateKey,
  fetchAccount,
  Signature,
} from 'snarkyjs';

import {
  loopUntilAccountExists,
  makeAndSendTransaction,
  zkAppNeedsInitialization,
  // accountExists
} from './utils.js';
import fs from 'fs';

(async function main() {
  await isReady;

  console.log('SnarkyJS loaded');

  // ----------------------------------------------------

  const Berkeley = Mina.BerkeleyQANet(
    'https://proxy.berkeley.minaexplorer.com/graphql'
  );
  Mina.setActiveInstance(Berkeley);

  let transactionFee = 100_000_000;

  const deployerKeysFileContents = fs.readFileSync(
    'keys/fee_payer.json',
    'utf8'
  );

  let key = JSON.parse(deployerKeysFileContents);

  const deployerPrivateKeyBase58 = key.privateKey;

  const deployerPrivateKey = PrivateKey.fromBase58(deployerPrivateKeyBase58);

  const zkAppKeysFileContents = fs.readFileSync('keys/berkeley.json', 'utf8');

  let zkAppkey = JSON.parse(zkAppKeysFileContents);

  const zkAppPrivateKeyBase58 = zkAppkey.privateKey;

  const zkAppPrivateKey = PrivateKey.fromBase58(zkAppPrivateKeyBase58);

  // ----------------------------------------------------

  let account = await loopUntilAccountExists({
    account: deployerPrivateKey.toPublicKey(),
    eachTimeNotExist: () => {
      console.log(
        'Deployer account does not exist. ' +
          'Request funds at faucet ' +
          'https://faucet.minaprotocol.com/?address=' +
          deployerPrivateKey.toPublicKey().toBase58()
      );
    },
    isZkAppAccount: false,
  });

  console.log(
    `Using fee payer account with nonce ${account.nonce}, balance ${account.balance}`
  );

  // ----------------------------------------------------

  const zkAppPublicKey = zkAppPrivateKey.toPublicKey();
  let zkapp = new PriceOracle(zkAppPublicKey);

  console.log('Compiling smart contract...');
  await PriceOracle.compile();

  let zkAppAccount = await loopUntilAccountExists({
    account: zkAppPublicKey,
    eachTimeNotExist: () => console.log('waiting to find zkApp account...'),
    isZkAppAccount: true,
  });

  //const needsInitialization = await zkAppNeedsInitialization({ zkAppAccount });

  //if (needsInitialization) {
  // console.log('initializing smart contract');
  // await makeAndSendTransaction({
  //     feePayerPrivateKey: deployerPrivateKey,
  //     zkAppPublicKey: zkAppPublicKey,
  //     mutateZkApp: () => zkapp.init(deployerPrivateKey),
  //     transactionFee: transactionFee,
  //     getState: () => zkapp.price.get(),
  //     statesEqual: (num1, num2) => num1.equals(num2).toBoolean(),
  // });
  //}

  let price = (await zkapp.price.get())!;
  console.log('current value of price is', price.toString());
  let oracleKey = (await zkapp.oraclePublicKey.get())!;
  console.log('current value of oracleKey is', oracleKey.toBase58());

  try {
    for (;;) {
      // ----------------------------------------------------
      // Request Price and Feed data to on-chain

      const priceUrl =
        'https://mina-price-feed-signer-m7gph.ondigitalocean.app/price';

      const response = await fetch(priceUrl);
      const data = await response.json();

      const priceResult = Field(data.data.price);
      const timeResult = Field(data.data.time);
      const signature = Signature.fromJSON(data.signature);
      console.log(`request ${priceUrl}
      - offchain-value price = ${data.data.price}
      - onchain-value RAW.ETH.USD.PRICE = ${Number(price.toBigInt())}
      - time = ${Number(timeResult.toBigInt())}`);

      let feePayer = deployerPrivateKey.toPublicKey();

      let account = await fetchAccount(
        { publicKey: feePayer },
        'https://proxy.berkeley.minaexplorer.com/graphql'
      );

      console.log('Done fetching accounts');
      let transaction = await Mina.transaction(
        { sender: feePayer, fee: transactionFee },
        () => {
          let oracle = new PriceOracle(zkAppPublicKey);
          oracle.verify(priceResult, timeResult, signature);
        }
      );

      // fill in the proof - this can take a while...
      console.log('Creating an execution proof...');
      const time0 = Date.now();
      await transaction.prove();
      const time1 = Date.now();
      console.log('creating proof took', (time1 - time0) / 1e3, 'seconds');

      // sign transaction with the deployer account
      transaction.sign([deployerPrivateKey]);

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

      let onChainData = (await zkapp.price.get())!;
      console.log('current value of price is', price.toString());
      console.log(
        'current value of ETH/USD is',
        Number(onChainData.toBigInt()) / 1000
      );
    }
  } catch (e) {
    console.log((e as Error).message);
  }

  // ----------------------------------------------------

  console.log('Shutting down');

  await shutdown();
})().catch((e) => console.log(e));
