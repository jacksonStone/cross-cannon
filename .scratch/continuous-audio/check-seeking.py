import json,subprocess,array,math,pathlib
m=json.load(open('public/continuous-audio.json'))['chapters']
def pcm(file,at):
 return array.array('h',subprocess.check_output(['ffmpeg','-v','error','-ss',str(at),'-i',file,'-t','2','-ar','22050','-ac','1','-f','s16le','pipe:1']))
for filename in ['01_Genesis_02.mp3','01_Genesis_40.mp3','18_Job_02.mp3']:
 e=m['/audio/WEBD_AT/'+filename]
 a=pcm('storage/audio/WEBD_AT/'+filename,4)
 b=pcm('storage/audio/continuous/'+pathlib.Path(e['url']).name,e['startSeconds']+4)
 n=min(len(a),len(b));a=a[:n];b=b[:n]
 corr=sum(x*y for x,y in zip(a,b))/math.sqrt(sum(x*x for x in a)*sum(y*y for y in b))
 best=(corr,0)
 for shift in range(-32,33):
  pairs=list(zip(a[max(0,shift):n+min(0,shift):4],b[max(0,-shift):n-max(0,shift):4]))
  score=sum(x*y for x,y in pairs)/math.sqrt(sum(x*x for x,y in pairs)*sum(y*y for x,y in pairs))
  if score>best[0]:best=(score,shift)
 print(filename,'correlation:',round(best[0],4),'offset error milliseconds:',round(best[1]/22.05,3))
 assert best[0]>.90
