import json,subprocess,sys,os
from PIL import Image
name,outname=sys.argv[1:3]
H=os.path.dirname(os.path.abspath(__file__)); m=json.load(open(f'{H}/raw/{name}/beats.json'))
d=f'{H}/chk/{name}'; os.makedirs(d,exist_ok=True)
ims=[]
for i,b in enumerate(m['beats']):
    t=3.5+b['start']+(b['end']-b['start'])*0.75
    f=f'{d}/{i:02}.png'
    subprocess.run(['ffmpeg','-v','error','-y','-ss',f'{t:.2f}','-i',f'{H}/out/{outname} - GUIA.mp4','-frames:v','1','-vf','scale=640:-1',f],check=True)
    ims.append(Image.open(f))
w,h=ims[0].size; cols=3; rows=(len(ims)+2)//3
S=Image.new('RGB',(w*cols,h*rows),'white')
for i,im in enumerate(ims): S.paste(im,((i%cols)*w,(i//cols)*h))
S.save(f'{d}/sheet.png'); print(f'{d}/sheet.png')
