// Off-server Brotli generation uses the existing Node build toolchain. Runtime
// delivery only streams these receipt-covered files; it never compresses them.
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {brotliCompressSync,constants} from 'node:zlib';

const extensions=new Set(['.wasm','.js','.css','.json','.html','.ttf','.bin']);
export function precompress(directory){
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);
    if(entry.isDirectory())precompress(file);
    else if(entry.isFile()&&extensions.has(path.extname(file))){
      const raw=readFileSync(file);
      const encoded=brotliCompressSync(raw,{params:{[constants.BROTLI_PARAM_QUALITY]:6}});
      if(encoded.length<raw.length)writeFileSync(file+'.br',encoded);
    }
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.argv[2])throw Error('Provide the browser staging directory.');
  precompress(process.argv[2]);
}
