import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
for(const name of fs.readdirSync('storage/audio/WEBD_AT').filter(n=>n.endsWith('.mp3')).filter((n,i)=>i%150===0)){
 console.log(name,execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_name,sample_rate,channels,start_time,duration:format=duration','-of','json',`storage/audio/WEBD_AT/${name}`],{encoding:'utf8'}));
}
