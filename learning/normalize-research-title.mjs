// Same public identity normalization as engine/cinemeta.mjs. Kept pure here so
// private processing never imports a metadata client or genre-owned seed map.
export function normalizeResearchTitle(value){
 return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[²]/g,'2')
  .replace(/&/g,'and').replace(/[^a-zA-Z0-9+]+/g,' ').trim().toLowerCase();
}
