import {
  Field,
  SmartContract,
  state,
  State,
  method,
  DeployArgs,
  Permissions,
  PublicKey,
  Signature,
  PrivateKey,
} from 'snarkyjs';

// The public key of our trusted data provider
const ORACLE_PUBLIC_KEY =
  'B62qrtK351di9YHvDtH6xis5TK3U5VjX3mdoBcUWP8kQWqV45k2enhq';

export class PriceOracle extends SmartContract {
  // Define contract state
  @state(PublicKey) oraclePublicKey = State<PublicKey>();
  @state(Field) price = State<Field>();
  // Define contract events
  events = {
    price: Field,
    time: Field,
  };

  deploy(args: DeployArgs) {
    super.deploy(args);
    this.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });
    this.oraclePublicKey.set(PublicKey.fromBase58(ORACLE_PUBLIC_KEY));
    this.price.set(Field(0));
  }

  @method verify(price: Field, time: Field, signature: Signature) {
    // Get the oracle public key from the contract state
    const oraclePublicKey = this.oraclePublicKey.get();
    this.oraclePublicKey.assertEquals(oraclePublicKey);
    // Evaluate whether the signature is valid for the provided data
    const validSignature = signature.verify(oraclePublicKey, [price, time]);
    // Check that the signature is valid
    validSignature.assertTrue();
    // Set the latest price in the contract
    this.price.set(price);
    // Emit an event containing the latest price fetched
    this.emitEvent('price', price);
    // Emit an event containing the latest time for the price fetched
    this.emitEvent('time', time);
  }
}
