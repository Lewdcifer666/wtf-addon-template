import {LearningError,readImmutable} from './git-artifacts.mjs';

const PRIVATE='Lewdcifer666/wtf-scifi-feedback';
const verified=new WeakSet();
export const isVerifiedReceipt=artifact=>!!artifact&&verified.has(artifact);

// Only this authenticated read path can create an in-process attestation. A
// JSON packet, copied object, or plausible 40-character commit cannot forge it.
// Consumers must still recompute from fresh complete inputs before each use.
export async function loadVerifiedReceipt({api,base,expected,assertCurrent}){
  if(typeof assertCurrent!=='function')throw new LearningError('currentness_check_required');
  const metadata=await api.get('/');
  if(api.repository!==PRIVATE||metadata.full_name!==PRIVATE||metadata.private!==true||metadata.default_branch!=='main')throw new LearningError('private_repository_required');
  if(!/^learning\/receipt-[a-f0-9]{64}$/.test(expected.branch))throw new LearningError('invalid_receipt');
  if(JSON.parse(expected.files['receipt.json']).sources.feedback_revision!==base.sha)throw new LearningError('stale_input');
  const record=await readImmutable(api,{base,...expected});
  if(!record)throw new LearningError('receipt_not_persisted');
  await assertCurrent();
  const artifact=Object.freeze({branch:record.branch,commit:record.commit,files:Object.freeze({...expected.files})});
  verified.add(artifact);
  return artifact;
}
