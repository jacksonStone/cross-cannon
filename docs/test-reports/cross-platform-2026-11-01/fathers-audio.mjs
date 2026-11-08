import puppeteer from 'puppeteer';
import {writeFile} from 'node:fs/promises';
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
let result;
try{
 await page.setViewport({width:390,height:844});await page.goto('http://127.0.0.1:13616/church-fathers',{waitUntil:'networkidle0'});
 await page.waitForSelector('.reader-passage-text');await page.click('[aria-label="Open reader tools"]');
 await page.click('[aria-label^="Play audio covering"]');
 await page.waitForFunction(()=>[...document.querySelectorAll('audio')].some(a=>!a.paused&&a.currentTime>0&&a.readyState>=2),{timeout:60000});
 const playing=await page.$eval('audio',a=>({currentTime:a.currentTime,duration:a.duration,src:a.currentSrc,paused:a.paused}));
 await page.screenshot({path:'docs/screenshots/cross-platform-e2e/web-fathers-audio.png'});
 await page.click('[aria-label^="Pause audio covering"]');await page.waitForFunction(()=>[...document.querySelectorAll('audio')].every(a=>a.paused));
 result={passed:true,playing,errors};
}catch(e){result={passed:false,error:e.message,errors};await page.screenshot({path:'docs/screenshots/cross-platform-e2e/web-fathers-audio-failure.png'});process.exitCode=1;}
finally{await browser.close();}
await writeFile('.scratch/cross-platform-e2e/fathers-audio.json',JSON.stringify(result,null,2));console.log(result);
