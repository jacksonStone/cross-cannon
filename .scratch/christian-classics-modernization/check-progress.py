"""Read-only coverage check; safe to rerun after a checkpoint or context reset."""
import datetime,json,pathlib,sys
repo=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(repo/'scripts'))
from classics_modernization import apply_overlay,load_overlays
public=repo/'public'
book=next(b for b in json.loads((public/'christian-classics-text/books.json').read_text())['books'] if b['id']=='classics:imitation')
overlays=load_overlays(repo/'data/public-domain/christian-classics/modernization')
completed=[]
remaining=[]
segments=0
published=0
for summary in book['chapters']:
    asset=json.loads((public/summary['assetPath'].lstrip('/')).read_text())
    if all(v.get('modernizedText','').strip() for v in asset['verses']): published+=1
    if apply_overlay(asset,book['id'],overlays):
        completed.append(asset['id'])
        segments+=len(asset['verses'])
    else: remaining.append(asset['id'])
report={'updatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'totalChapters':len(book['chapters']),'validatedChapters':len(completed),'validatedSegments':segments,'publishedChapters':published,'completed':completed,'remaining':remaining}
(repo/'.scratch/christian-classics-modernization/PROGRESS.json').write_text(json.dumps(report,indent=2)+'\n')
print(f"Validated {len(completed)}/{len(book['chapters'])} chapters ({segments} segments); {published} currently in generated library.")
