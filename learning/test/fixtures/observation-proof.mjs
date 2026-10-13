// Ephemeral synthetic keys exist only in test memory. Production never reads
// fixture keys, custom issuer URLs or proof providers from packets/config.
import {generateKeyPairSync,sign} from 'node:crypto';
import {proofAudience,verifyObservationProof,PROOF_ISSUER,PROOF_REPOSITORY} from '../../observation-proof.mjs';
const pair=generateKeyPairSync('rsa',{modulusLength:2048}),key={...pair.publicKey.export({format:'jwk'}),kid:'synthetic-oidc',kty:'RSA',use:'sig',alg:'RS256'};
export function fixtureObservationProof({clock=()=>new Date('2026-10-12T08:00:00Z')}={}){
 return {
  key,
  async sign(body,revision,extra={}){
   const iat=Math.floor(+clock()/1000),header={typ:'JWT',alg:'RS256',kid:key.kid};
   const claims={iss:PROOF_ISSUER,aud:proofAudience(body),repository:PROOF_REPOSITORY,repository_id:'1343321761',repository_owner_id:'147663657',repository_visibility:'private',ref:'refs/heads/main',sha:revision,
    workflow_ref:PROOF_REPOSITORY+'/.github/workflows/learning-finalize.yml@refs/heads/main',event_name:'schedule',run_id:'1',iat,nbf:iat,exp:iat+300,...extra};
   const bytes=[header,claims].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');return bytes+'.'+sign('RSA-SHA256',Buffer.from(bytes),pair.privateKey).toString('base64url');
  },
  async verify(token,body,revision){return verifyObservationProof(token,body,revision,[key],{now:+clock()});}
 };
}
