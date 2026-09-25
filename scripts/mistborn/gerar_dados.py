"""
Gera data/br_mistborn.json a partir do PDF do Cosmere RPG: Mistborn Handbook.

Uso:
    python scripts/mistborn/gerar_dados.py caminho/para/Cosmere_RPG_Mistborn_Handbook.pdf

Requer PyMuPDF (pip install pymupdf). O PDF não é copiado nem versionado: o script
só lê a estrutura dos talentos (nome, pré-requisitos, árvore). As descrições
continuam vindo do PDF do próprio usuário pelo botão "Carregar Livro (PDF)".

Etapas:
  1. extrai o texto das páginas 34–255 (ancestralidades, trilhas, caminhos e metais);
  2. acha cada talento pelo par "Prerequisite:" / "Activation:";
  3. separa requisitos de perícia, dependências e textos especiais;
  4. traduz com traducoes.json (+ nomes já existentes em data/skills.json ↔ br_skills.json)
     e grava o JSON final, uma linha por talento.
"""
import json, os, re, sys
from collections import OrderedDict
import fitz  # PyMuPDF

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

if len(sys.argv) < 2:
    sys.exit("Uso: python scripts/mistborn/gerar_dados.py <Mistborn_Handbook.pdf>")

# ---- Etapa 1: texto das páginas ----
_doc = fitz.open(sys.argv[1])
PAGES = {i + 1: _doc[i].get_text() for i in range(len(_doc))}

# Traduções já usadas nas trilhas do Stormlight (mesmos IDs nos dois arquivos)
_en = json.load(open(os.path.join(ROOT, "data", "skills.json"), encoding="utf-8"))
_br = json.load(open(os.path.join(ROOT, "data", "br_skills.json"), encoding="utf-8"))
EXISTING_EN2PT = {e["name"]: b["name"] for e, b in zip(_en, _br)}

# ---- Etapa 2: localizar talentos ----
d=PAGES
def clean(s): return s.replace("\u00ad","").replace("\u202f"," ").replace("\u2019","'").replace("\u2018","'").strip()
lines=[]
for p in range(34,256):
    for l in d[p].split("\n"):
        lines.append((p,clean(l)))
entries=[]; section=None
sec_re=re.compile(r"appear in the (.+?) (specialty|talent tree|tree)")
buf=""
for i,(p,l) in enumerate(lines):
    # section detection over joined window
    w=" ".join(x[1] for x in lines[i:i+4])
    if l.startswith("The following talents"):
        m=sec_re.search(w)
        if m: section=m.group(1).replace("the ","")
    if l.startswith("Prerequisite:") or l.startswith("Prerequisites:"):
        # gather prereq until Activation
        j=i; txt=l
        while not lines[j+1][1].startswith("Activation") and j-i<5:
            j+=1; txt+=" "+lines[j][1]
        if not lines[j+1][1].startswith("Activation"): continue
        name=lines[i-1][1]
        entries.append(dict(page=p,section=section,name=name,prereq=re.sub(r"^Prerequisites?:\s*","",txt)))

# ---- Etapa 3: estruturar requisitos ----
ents=entries
# ---- fixes ----
NAME_FIX={"(Koloss-Blooded Key)":"Koloss Stamina (Koloss-Blooded Key)","(Feruchemist Key)":"Feruchemist Heritage (Feruchemist Key)"}
SEC_FIX={("Investigator","Leverage Dissent"):"Rebel",("Thief","Galvanize"):"Faithful",("Thief","Inspired Zeal"):"Faithful",
 ("Surgeon","Grappler's Stance"):"Brawler",("Electrum Allomancy","Alloy of Self"):"Gold Allomancy",("Electrum Allomancy","Golden Opportunities"):"Gold Allomancy"}
INVENTOR={"Hasty Adjustment","Proficient Operator","Acute Scrutiny","Gunsmith","It's in Here Somewhere","Modern Marveller","Out of a Jam","Detonation Expert"}
STRAT={"Strategize","Composed","Deep Contemplation","Contingency","Keen Insight","Turning Point","Mind and Body","Know Your Moment"}
PATH_OF={'Investigator':'Agent','Rebel':'Agent','Thief':'Agent','Faithful':'Envoy','Grifter':'Envoy','Mentor':'Envoy',
 'Hazekiller':'Hunter','Sharpshooter':'Hunter','Tracker':'Hunter','Mastermind':'Leader','Officer':'Leader','Politico':'Leader',
 'Inventor':'Scholar','Strategist':'Scholar','Surgeon':'Scholar','Brawler':'Warrior','Gunslinger':'Warrior','Soldier':'Warrior'}
SKILLS_EN={"Athletics","Heavy Weaponry","Light Weaponry","Agility","Stealth","Thievery","Deduction","Crafting","Medicine","Lore",
 "Discipline","Intimidation","Insight","Perception","Survival","Deception","Leadership","Persuasion","Allomancy","Feruchemy",
 "Willpower","Strength","Speed","Intellect","Awareness","Presence"}
struct=[]
for e in ents:
    name=NAME_FIX.get(e['name'],e['name']).replace("\xa0"," ")
    sec=e['section']
    sec=SEC_FIX.get((sec,name),sec)
    if sec in('Inventor','Strategist','Surgeon') and name in INVENTOR: sec='Inventor'
    elif sec in('Inventor','Strategist','Surgeon') and name in STRAT: sec='Strategist'
    pr=e['prereq'].replace("\xa0"," ").replace("Worse Case","Worst-Case").replace("Deduction +1","Deduction 1+").replace("Leadership 1+:","Leadership 1+;")
    pr=re.sub(r"(Steel|Zinc|Cadmium) (Allomancy|Feruchemy)$",r"\1 \2 power",pr)
    pr=pr.replace("Cadmium Allomancy;","Cadmium Allomancy power;")
    # key detection
    key=None
    m=re.match(r"(.+?) \((.+?) Key\)$",name)
    if m: name,key=m.group(1),m.group(2)
    # split prereqs by ; (and , between stat reqs)
    parts=[p.strip() for p in re.split(r";|,(?= *[A-Z])",pr) if p.strip() and p.strip()!='none']
    reqs=[];deps=[];other=[]
    for p in parts:
        alts=[a.strip() for a in re.split(r"\bor\b",p)]
        # stat group?
        sg=[re.match(r"^(.+?) (\d+)\+$",a) for a in alts]
        if all(sg) and all(x.group(1) in SKILLS_EN or x.group(1)=="Level" for x in sg):
            reqs.append([{"stat":x.group(1),"val":int(x.group(2))} for x in sg]); continue
        tg=[re.match(r"^(.+?) (key talent|talent|power)$",a) for a in alts]
        if all(tg):
            deps.append([x.group(1) for x in tg]); continue
        other.append(p)
    if key: sec={'Agent':'Agent','Envoy':'Envoy','Hunter':'Hunter','Leader':'Leader','Scholar':'Scholar','Warrior':'Warrior'}.get(key, key)
    struct.append(dict(section=sec,name=name,key=key,reqs=reqs,deps=deps,other=other,page=e['page']))

# ---- Etapa 4: traduzir e gravar ----
S=struct
T={**EXISTING_EN2PT, **json.load(open(os.path.join(HERE,'traducoes.json'),encoding='utf-8'))}
for o in S:
    if o['page'] in (38,39,40): o['section']='Kandra'
    if o['page'] in (41,42): o['section']='Koloss-Blooded'

PATH_PT={'Agent':'Agente','Envoy':'Emissário','Hunter':'Caçador','Leader':'Líder','Scholar':'Erudito','Warrior':'Guerreiro'}
SPEC={ # en -> (path_en, pt, book)
 'Investigator':('Agent','Investigador','both'),'Rebel':('Agent','Rebelde','mistborn'),'Thief':('Agent','Ladrão','both'),
 'Faithful':('Envoy','Fiel','both'),'Grifter':('Envoy','Trapaceiro','mistborn'),'Mentor':('Envoy','Mentor','both'),
 'Hazekiller':('Hunter','Matabrumas','mistborn'),'Sharpshooter':('Hunter','Atirador de Elite','mistborn'),'Tracker':('Hunter','Rastreador','both'),
 'Mastermind':('Leader','Idealizador','mistborn'),'Officer':('Leader','Oficial','both'),'Politico':('Leader','Político','both'),
 'Inventor':('Scholar','Inventor','mistborn'),'Strategist':('Scholar','Estrategista','both'),'Surgeon':('Scholar','Cirurgião','both'),
 'Brawler':('Warrior','Brigão','mistborn'),'Gunslinger':('Warrior','Pistoleiro','mistborn'),'Soldier':('Warrior','Soldado','both'),
}
STAT_NORM={'Heavy Weaponry':'Heavy Weapons','Light Weaponry':'Light Weapons','Level':'level'}
METALS=[ # key, pt, en, color, pair
 ('ferro','Ferro','Iron','#7d8691','aco'),('aco','Aço','Steel','#9fb7d1','ferro'),
 ('estanho','Estanho','Tin','#dfe4e8','peltre'),('peltre','Peltre','Pewter','#a8a499','estanho'),
 ('zinco','Zinco','Zinc','#7fa7b8','latao'),('latao','Latão','Brass','#d9b44a','zinco'),
 ('cobre','Cobre','Copper','#cd7f45','bronze'),('bronze','Bronze','Bronze','#b3874f','cobre'),
 ('cromo','Cromo','Chromium','#c7d3e8','nicrosil'),('nicrosil','Nicrosil','Nicrosil','#9d9fc4','cromo'),
 ('aluminio','Alumínio','Aluminum','#eef1f4','duraluminio'),('duraluminio','Duralumínio','Duralumin','#b9c2cc','aluminio'),
 ('cadmio','Cádmio','Cadmium','#c2b36a','bendaliga'),('bendaliga','Curvaliga','Bendalloy','#7fb29a','cadmio'),
 ('ouro','Ouro','Gold','#f0c24a','electro'),('electro','Electro','Electrum','#e8d68a','ouro'),
 ('atium','Atium','Atium','#b7a6e0',None),
]
EN2KEY={m[2]:m[0] for m in METALS}; KEY2PT={m[0]:m[1] for m in METALS}
ALLO={ # key: misting pt, misting en, effect pt, category, push/pull, int/ext, era
 'ferro':('Atraidor','Lurcher','Puxa metais próximos','Físico','Puxar','Externo','ambas'),
 'aco':('Lança-Moedas','Coinshot','Empurra metais próximos','Físico','Empurrar','Externo','ambas'),
 'estanho':('Olhos de Estanho','Tineye','Aguça os sentidos','Físico','Puxar','Interno','ambas'),
 'peltre':('Braço-de-Peltre','Pewterarm/Thug','Aprimora as capacidades físicas','Físico','Empurrar','Interno','ambas'),
 'zinco':('Incitador','Rioter','Inflama as emoções alheias','Mental','Puxar','Externo','ambas'),
 'latao':('Apaziguador','Soother','Abranda as emoções alheias','Mental','Empurrar','Externo','ambas'),
 'cobre':('Esfumaceador','Smoker/Coppercloud','Oculta Artes Investidas próximas','Mental','Puxar','Interno','ambas'),
 'bronze':('Buscador','Seeker','Detecta o uso de Artes Investidas','Mental','Empurrar','Interno','ambas'),
 'cromo':('Sanguessuga','Leecher','Drena as reservas de Investidura alheias','Aprimoramento','Puxar','Externo','e2'),
 'nicrosil':('Nicroexplosor','Nicroburst','Faz explodir os efeitos Investidos alheios','Aprimoramento','Empurrar','Externo','e2'),
 'aluminio':('Mosquito de Alumínio','Aluminum Gnat/Void','Drena suas próprias reservas de Investidura','Aprimoramento','Puxar','Interno','e2late'),
 'duraluminio':('Mosquito de Duralumínio','Duralumin Gnat','Faz explodir seus próprios efeitos Investidos','Aprimoramento','Empurrar','Interno','e2late'),
 'cadmio':('Pulsador','Pulser','Cria uma bolha de tempo desacelerado','Temporal','Puxar','Externo','e2'),
 'bendaliga':('Deslizante','Slider','Cria uma bolha de tempo acelerado','Temporal','Empurrar','Externo','e2'),
 'ouro':('Adivinho','Augur','Revela seu passado e seus eus alternativos','Temporal','Puxar','Interno','ambas'),
 'electro':('Oráculo','Oracle','Revela seus futuros possíveis imediatos','Temporal','Empurrar','Interno','e2late'),
 'atium':('Vidente','Seer','Revela os futuros imediatos dos outros','Divino',None,None,'e1'),
}
FERU={ # ferring pt, en, effect pt, category, alloy/pure, era
 'ferro':('Rasante','Skimmer','Armazena peso','Físico','Puro','ambas'),
 'aco':('Corredor-de-Aço','Steelrunner','Armazena velocidade física','Físico','Liga','ambas'),
 'estanho':('Sussurravento','Windwhisperer','Armazena sentidos','Físico','Puro','ambas'),
 'peltre':('Bruto','Brute','Armazena força','Físico','Liga','ambas'),
 'zinco':('Faiscador','Sparker','Armazena velocidade mental','Cognitivo','Puro','ambas'),
 'latao':('Almaflama','Firesoul','Armazena calor','Cognitivo','Liga','ambas'),
 'cobre':('Arquivista','Archivist','Armazena memórias','Cognitivo','Puro','ambas'),
 'bronze':('Sentinela','Sentry','Armazena vigília','Cognitivo','Liga','ambas'),
 'cromo':('Fiandeiro','Spinner','Armazena Fortuna espiritual','Espiritual','Puro','e2'),
 'nicrosil':('Portador de Almas','Soulbearer','Armazena habilidades Investidas','Espiritual','Liga','e2'),
 'aluminio':('Eu-Verdadeiro','Trueself','Armazena Identidade espiritual','Espiritual','Puro','e2late'),
 'duraluminio':('Conector','Connector','Armazena Conexão espiritual','Espiritual','Liga','e2late'),
 'cadmio':('Ofegante','Gasper','Armazena fôlego','Híbrido','Puro','e2'),
 'bendaliga':('Absorvedor','Subsumer','Armazena nutrição','Híbrido','Liga','e2'),
 'ouro':('Sanguífero','Bloodmaker','Armazena saúde','Híbrido','Puro','ambas'),
 'electro':('Pináculo','Pinnacle','Armazena determinação','Híbrido','Liga','e2late'),
 'atium':('Tecetempo','Timewinder','Armazena juventude','Divino',None,'e1'),
}
PATHS=OrderedDict([
 ('Misting',dict(pt='Brumoso',key='Misting Snap',ancestries=['human','koloss'],allo=1,feru=0,era='ambas',startSkill='alomancia',investiture=True,grantsRanks={'alomancia':1})),
 ('Mistborn',dict(pt='Nascido da Bruma',key='Mistborn Snap',ancestries=['human'],allo='all',feru=0,era='e1',startSkill=None,investiture=True,grantsRanks={'alomancia':1})),
 ('Feruchemist',dict(pt='Feruquemista',key='Feruchemist Heritage',ancestries=['human'],allo=0,feru='all',era='e1',startSkill=None,investiture=False,grantsRanks={'feruquimia':1})),
 ('Ferring',dict(pt='Ferroso',key='Ferring Heritage',ancestries=['human','koloss'],allo=0,feru=1,era='e2',startSkill='feruquimia',investiture=False,grantsRanks={'feruquimia':1})),
 ('Twinborn',dict(pt='Duplonato',key='Twinborn Heritage',ancestries=['human','koloss'],allo=1,feru=1,era='e2',startSkill='disciplina',investiture=True,grantsRanks={'alomancia':1,'feruquimia':1})),
])
OTHER_PT={
 'Have a patron or companion who is a member of the criminal underworld':'Ter um patrono ou companheiro do submundo do crime',
 'Have a companion':'Ter um companheiro','Have an animal companion':'Ter um companheiro animal',
 'Lead an organization or have a patron who grants you authority over others':'Liderar uma organização ou ter um patrono que conceda autoridade sobre outros',
 'Have a patron':'Ter um patrono',
 "Your Twinborn Heritage talent's powers use different metals":'Seus poderes de Duplonato usam metais diferentes',
 "your Twinborn Heritage talent's powers use the same metal":'Seus poderes de Duplonato usam o mesmo metal',
 'at least one other power or Invested ability':'Ter ao menos um outro poder ou habilidade Investida',
 'at least two other powers or Invested abilities':'Ter ao menos dois outros poderes ou habilidades Investidas',
 'Expertise in either a Defensive weapon or armor with a deflect of 3+':'Especialidade em uma arma Defensiva ou armadura com deflexão 3+',
}
def artname(art,key): return ('Alomancia' if art=='allo' else 'Feruquemia')+' de '+KEY2PT[key]
def tr(n):
    m=re.match(r"^(\w+) (Allomancy|Feruchemy)$",n)
    if m and m.group(1) in EN2KEY: return artname('allo' if m.group(2)=='Allomancy' else 'feru',EN2KEY[m.group(1)])
    if n in T: return T[n]
    raise KeyError(n)
def conv_reqs(reqs):
    return [[{"stat":STAT_NORM.get(r['stat'],r['stat']),"val":r['val']} for r in g] for g in reqs]
warn=[]
def mk(o,cls,sub,extra=None):
    deps=[[tr(x) for x in g] for g in o['deps']]
    if len(deps)>1: warn.append((o['name'],deps))
    flat=deps[0] if deps else []
    reqs=conv_reqs(o['reqs'])
    d=dict(cls=cls,sub=sub,name=tr(o['name']),en=o['name'],deps=flat,reqs=reqs,
           prereqText='; '.join(OTHER_PT.get(x,x) for x in o['other'] if 'ancestry' not in x and 'no other Snap' not in x) or None,
           description="")
    if len(reqs)==1 and len(reqs[0])==1: d['reqStat'],d['reqVal']=reqs[0][0]['stat'],reqs[0][0]['val']
    else: d['reqStat'],d['reqVal']=None,0
    if extra: d.update(extra)
    return d
def depth(items,rootnames):
    by={i['name']:i for i in items}; memo={}
    def dd(n,stack=()):
        if n in rootnames: return 0
        if n in memo: return memo[n]
        it=by.get(n)
        ps=[p for p in (it['deps'] if it else []) if p not in stack]
        v=1 if not ps else 1+min(dd(p,stack+(n,)) for p in ps)
        memo[n]=v; return v
    for i in items:
        if i.get('rank') is None: i['rank']=dd(i['name'])

# ---------- heroic ----------
heroic=[]; keys_en={}
for o in S:
    if o['key'] in PATH_PT: keys_en[o['key']]=o['name']
for o in S:
    sec=o['section']
    if sec in SPEC and SPEC[sec][2]=='mistborn':
        path,subpt,_=SPEC[sec]
        it=mk(o,PATH_PT[path],subpt)
        keypt=T[keys_en[path]]
        it['deps']=[x for x in it['deps'] if x!=keypt]
        it['rank']=None
        if sec in('Inventor','Gunslinger'): it['era']='e2'
        heroic.append(it)
for cls in set(h['cls'] for h in heroic):
    for sub in set(i['sub'] for i in heroic if i['cls']==cls):
        depth([i for i in heroic if i['cls']==cls and i['sub']==sub],set())
ORDER={'Agente':['Investigador','Espião','Ladrão','Rebelde'],'Emissário':['Diplomata','Fiel','Mentor','Trapaceiro'],
 'Caçador':['Arqueiro','Assassino','Rastreador','Matabrumas','Atirador de Elite'],'Líder':['Campeão','Oficial','Político','Idealizador'],
 'Erudito':['Artifabriano','Estrategista','Cirurgião','Inventor'],'Guerreiro':['Duelista','Fractário','Soldado','Brigão','Pistoleiro']}
BOOK={v[1]:v[2] for v in SPEC.values()}
specialties=OrderedDict((cls,[{"sub":s,"book":BOOK.get(s,'stormlight')} for s in subs]) for cls,subs in ORDER.items())
SPEC_ERA={'Inventor':'e2','Pistoleiro':'e2'}

# ---------- ancestry ----------
anc=[]
for o in S:
    if o['section']=='Kandra': anc.append(mk(o,'Kandra','-' if o['key'] else 'Kandra'))
    if o['section']=='Koloss-Blooded': anc.append(mk(o,'Sangue-Koloss','-' if o['key'] else 'Sangue-Koloss'))
for a in anc: a['rank']=0 if a['sub']=='-' else None
for cls in ('Kandra','Sangue-Koloss'):
    items=[a for a in anc if a['cls']==cls]
    depth(items,{a['name'] for a in items if a['rank']==0})
for a in anc:
    if a['en'] in('Natural Form','Kandra Disguise','Koloss Stamina'): a['grantedByAncestry']=True

# ---------- metalborn paths ----------
mb=[]
for o in S:
    if o['section'] in PATHS:
        p=PATHS[o['section']]
        it=mk(o,p['pt'],'-' if o['key'] else p['pt'])
        it['rank']=0 if o['key'] else None
        mb.append(it)
for pen,p in PATHS.items():
    depth([i for i in mb if i['cls']==p['pt']],{T[p['key']]})
paths_out=OrderedDict()
for pen,p in PATHS.items():
    q=OrderedDict(en=pen,key=T[p['key']],keyEn=p['key'])
    for k,v in p.items():
        if k not in('pt','key'): q[k]=v
    paths_out[p['pt']]=q

# ---------- metal arts ----------
TRAIT={'aluminio':'Identity','atium':'Youth','bendaliga':'Nutrition','latao':'Warmth','bronze':'Wakefulness','cadmio':'Breath',
 'cromo':'Fortune','cobre':'Memory','duraluminio':'Connection','electro':'Determination','ouro':'Health','ferro':'Weight',
 'nicrosil':'Investiture','peltre':'Strength','aco':'Speed','estanho':'Sense','zinco':'Mental Speed'}
arts=[]
for m in METALS:
    for art in('allo','feru'):
        sec=m[2]+(' Allomancy' if art=='allo' else ' Feruchemy')
        cls=artname(art,m[0])
        # No livro a descrição do poder vem sob a ação "Burn X" / "Store Y"
        alias = ('Burn '+m[2]) if art=='allo' else ('Store '+TRAIT[m[0]])
        arts.append(dict(cls=cls,sub='-',name=cls,en=sec,aliasEn=alias,deps=[],reqs=[],reqStat=None,reqVal=0,prereqText=None,description="",rank=0,art=art,metal=m[0],isPower=True))
        items=[mk(o,cls,cls,dict(art=art,metal=m[0])) for o in S if o['section']==sec]
        for i in items: i['rank']=None
        depth(items,{cls})
        arts.extend(items)
SVG={'ferro':'Iron','aco':'Steel','estanho':'Tin','peltre':'Pewter','zinco':'Zinc','latao':'Brass','cobre':'Copper','bronze':'Bronze','atium':'Atium',
     'cromo':'Chromium','nicrosil':'Nicrosil','aluminio':'Aluminum','duraluminio':'Duralumin','cadmio':'Cadmium','bendaliga':'Bendalloy','ouro':'Gold','electro':'Electrum'}
metals_out=[]
for m in METALS:
    a=ALLO[m[0]]; f=FERU[m[0]]
    metals_out.append(OrderedDict(key=m[0],name=m[1],en=m[2],color=m[3],pair=m[4],svg=f"svg/Mistborn/Metals/{SVG[m[0]]}.svg",
      allo=OrderedDict(tree=artname('allo',m[0]),misting=a[0],mistingEn=a[1],effect=a[2],category=a[3],pushPull=a[4],intExt=a[5],era=a[6]),
      feru=OrderedDict(tree=artname('feru',m[0]),ferring=f[0],ferringEn=f[1],effect=f[2],category=f[3],alloy=f[4],era=f[5])))
for lst,base in((heroic,30000),(anc,40000),(mb,50000),(arts,60000)):
    for i,x in enumerate(lst,1): x['id']=base+i
KORDER=['id','cls','sub','rank','name','en','aliasEn','reqStat','reqVal','reqs','deps','prereqText','era','art','metal','isPower','grantedByAncestry','description']
def order(x): return OrderedDict((k,x[k]) for k in KORDER if k in x)
out=OrderedDict(
  _comment="Estrutura do Cosmere RPG: Mistborn Handbook (nomes traduzidos pelo projeto; 'en' = nome original). As descrições vêm do PDF do próprio usuário.",
  specialties=specialties,specialtyEra=SPEC_ERA,
  heroic=[order(x) for x in heroic],ancestry=[order(x) for x in anc],paths=paths_out,
  metalbornTalents=[order(x) for x in mb],metals=metals_out,arts=[order(x) for x in arts])
P=os.path.join(ROOT,'data','br_mistborn.json')
dump=lambda o: json.dumps(o,ensure_ascii=False)
lines=['{']; items=list(out.items())
for idx,(k,v) in enumerate(items):
    comma=',' if idx<len(items)-1 else ''
    if isinstance(v,list):
        lines.append(f'  "{k}": [')
        for j,x in enumerate(v): lines.append('    '+dump(x)+(',' if j<len(v)-1 else ''))
        lines.append('  ]'+comma)
    elif isinstance(v,dict):
        lines.append(f'  "{k}": {{')
        vi=list(v.items())
        for j,(kk,vv) in enumerate(vi): lines.append(f'    "{kk}": '+dump(vv)+(',' if j<len(vi)-1 else ''))
        lines.append('  }'+comma)
    else: lines.append(f'  "{k}": '+dump(v)+comma)
lines.append('}')
open(P,'w',encoding='utf-8').write('\n'.join(lines)+'\n')
json.load(open(P,encoding='utf-8'))
print('warn',warn)
print(len(heroic),len(anc),len(mb),len(arts))
