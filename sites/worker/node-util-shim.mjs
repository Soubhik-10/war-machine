/* mppx's HTTP offer merger needs only Node's structural equality helper. */
const canonical=value=>{
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
};

export const isDeepStrictEqual=(left,right)=>canonical(left)===canonical(right);
