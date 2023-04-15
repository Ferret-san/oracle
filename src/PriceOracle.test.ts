import { PriceOracle } from './PriceOracle';
import {
  isReady,
  shutdown,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  Signature,
} from 'snarkyjs';

// The public key of our trusted data provider
const ORACLE_PUBLIC_KEY =
  'B62qrtK351di9YHvDtH6xis5TK3U5VjX3mdoBcUWP8kQWqV45k2enhq';

let proofsEnabled = false;
function createLocalBlockchain() {
  const Local = Mina.LocalBlockchain({ proofsEnabled });
  Mina.setActiveInstance(Local);
  return Local.testAccounts[0].privateKey;
}

async function localDeploy(
  zkAppInstance: PriceOracle,
  zkAppPrivatekey: PrivateKey,
  deployerAccount: PrivateKey
) {
  const txn = await Mina.transaction(deployerAccount, () => {
    AccountUpdate.fundNewAccount(deployerAccount);
    zkAppInstance.deploy({ zkappKey: zkAppPrivatekey });
    zkAppInstance.init(zkAppPrivatekey);
  });
  await txn.prove();
  txn.sign([zkAppPrivatekey]);
  await txn.send();
}

describe('PriceOracle', () => {
  let deployerAccount: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey;

  beforeAll(async () => {
    await isReady;
    if (proofsEnabled) PriceOracle.compile();
  });

  beforeEach(async () => {
    deployerAccount = createLocalBlockchain();
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
  });

  afterAll(async () => {
    // `shutdown()` internally calls `process.exit()` which will exit the running Jest process early.
    // Specifying a timeout of 0 is a workaround to defer `shutdown()` until Jest is done running all tests.
    // This should be fixed with https://github.com/MinaProtocol/mina/issues/10943
    setTimeout(shutdown, 5000000);
  });

  it('generates and deploys the `PriceOracle` smart contract', async () => {
    const zkAppInstance = new PriceOracle(zkAppAddress);
    await localDeploy(zkAppInstance, zkAppPrivateKey, deployerAccount);
    const oraclePublicKey = zkAppInstance.oraclePublicKey.get();
    expect(oraclePublicKey).toEqual(PublicKey.fromBase58(ORACLE_PUBLIC_KEY));
  });

  describe('actual API requests', () => {
    it('emits events containing the price and the time it was fetched if the provided signature is valid', async () => {
      const zkAppInstance = new PriceOracle(zkAppAddress);
      await localDeploy(zkAppInstance, zkAppPrivateKey, deployerAccount);

      const response = await fetch('http://localhost:3000/price');
      const data = await response.json();

      const price = Field(data.data.price);
      const time = Field(data.data.time);
      const signature = Signature.fromJSON(data.signature);

      const txn = await Mina.transaction(deployerAccount, () => {
        zkAppInstance.verify(
          price,
          time,
          signature ?? fail('something is wrong with the signature')
        );
      });
      await txn.prove();
      await txn.send();
    });
  });

  describe('hardcoded values', () => {
    it('throws an error if the credit score is above 700 and the provided signature is invalid', async () => {
      const zkAppInstance = new PriceOracle(zkAppAddress);
      await localDeploy(zkAppInstance, zkAppPrivateKey, deployerAccount);

      const response = await fetch('http://localhost:3000/price');
      const data = await response.json();

      const price = Field(data.data.price);
      const time = Field(data.data.time);
      const signature = Signature.fromJSON({
        r: '26545513748775911233424851469484096799413741017006352456100547880447752952428',
        s: '7381406986124079327199694038222605261248869991738054485116460354242251864564',
      });

      expect(async () => {
        await Mina.transaction(deployerAccount, () => {
          zkAppInstance.verify(
            price,
            time,
            signature ?? fail('something is wrong with the signature')
          );
        });
      }).rejects;
    });
  });
});
