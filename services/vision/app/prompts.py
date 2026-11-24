"""Curated English prompt ensembles for zero-shot heads + Spanish→English query glossary.

FashionSigLIP was trained on English product titles/descriptions, so every
vocabulary id gets several English synonyms × templates; a class prototype is
the L2-normalised mean of their text embeddings. Spanish text queries for
``/v1/embed/text`` are rewritten to English with :func:`translate_query`, a
deterministic glossary built from the vocabulary labels (no external services).
"""

from __future__ import annotations

import re
import unicodedata
from functools import lru_cache

from .vocabulary import load_vocabulary

PROMPTS_VERSION = "2026-11-24.1"

GARMENT_TEMPLATES: tuple[str, ...] = (
    "{}",
    "a photo of {}",
    "a product photo of {} on a white background",
    "{}, fashion e-commerce photo",
)

SUBCATEGORY_PROMPTS: dict[str, tuple[str, ...]] = {
    # --- top
    "camiseta": ("a t-shirt", "a short sleeve t-shirt", "a crew neck tee", "a basic cotton t-shirt"),
    "camiseta_manga_larga": ("a long sleeve t-shirt", "a long-sleeved tee", "a long sleeve jersey top"),
    "camiseta_tecnica": ("a sports t-shirt", "a technical running shirt", "a performance athletic tee", "a gym training top"),
    "polo": ("a polo shirt", "a pique polo shirt with collar and buttons", "a short sleeve polo"),
    "camisa": ("a button-down shirt", "a long sleeve dress shirt", "an oxford shirt", "a collared button-up shirt"),
    "camisa_manga_corta": ("a short sleeve button-up shirt", "a short-sleeved collared shirt", "a hawaiian shirt"),
    "sobrecamisa": ("an overshirt", "a shirt jacket", "a heavy flannel overshirt", "a shacket"),
    "blusa": ("a blouse", "a women's blouse", "a silky blouse", "a ruffled blouse"),
    "top": ("a tank top", "a camisole", "a crop top", "a strappy top"),
    "body": ("a bodysuit", "a women's bodysuit", "a fitted bodysuit top"),
    "jersey": ("a sweater", "a knit pullover", "a fine knit jumper", "a crewneck sweater"),
    "jersey_grueso": ("a chunky knit sweater", "a thick cable knit jumper", "a heavy wool sweater", "a turtleneck sweater"),
    "sudadera": ("a sweatshirt", "a hoodie", "a hooded sweatshirt", "a crewneck sweatshirt"),
    "cardigan": ("a cardigan", "a button-up knit cardigan", "a knitted cardigan"),
    "chaleco_punto": ("a sweater vest", "a knit vest", "a sleeveless knit pullover"),
    # --- bottom
    "pantalon": ("trousers", "pants", "casual pants", "straight leg trousers"),
    "pantalon_vestir": ("dress pants", "tailored trousers", "suit trousers", "formal pleated trousers"),
    "vaquero": ("jeans", "denim jeans", "blue jeans", "denim pants"),
    "chino": ("chinos", "chino pants", "khaki chino trousers", "cotton twill chinos"),
    "pantalon_corto": ("shorts", "casual shorts", "denim shorts", "cotton shorts"),
    "bermuda": ("bermuda shorts", "knee-length shorts", "long cargo shorts"),
    "falda": ("a skirt", "a mini skirt", "a short skirt", "a pleated skirt"),
    "falda_larga": ("a long skirt", "a maxi skirt", "a midi skirt", "an ankle-length skirt"),
    "leggings": ("leggings", "yoga leggings", "tight black leggings"),
    "jogger": ("jogger pants", "sweatpants", "track pants", "jogging bottoms"),
    "pantalon_deportivo_corto": ("athletic shorts", "running shorts", "gym shorts", "sports shorts"),
    # --- one piece
    "vestido": ("a dress", "a summer dress", "a casual dress", "a midi dress"),
    "vestido_punto": ("a knit dress", "a sweater dress", "a ribbed knit dress"),
    "vestido_fiesta": ("an evening gown", "a party dress", "a cocktail dress", "a formal evening dress"),
    "mono": ("a jumpsuit", "a romper", "dungarees overalls", "a playsuit"),
    "traje_chandal": ("a tracksuit", "a matching tracksuit set with jacket and pants"),
    # --- outerwear
    "americana": ("a blazer", "a suit jacket", "a tailored blazer"),
    "chaqueta": ("a jacket", "a casual jacket", "a lightweight jacket", "a zip jacket"),
    "cazadora_vaquera": ("a denim jacket", "a jean jacket", "a denim trucker jacket"),
    "chaqueta_cuero": ("a leather jacket", "a biker jacket", "a leather moto jacket"),
    "bomber": ("a bomber jacket", "a flight jacket", "a satin bomber jacket"),
    "gabardina": ("a trench coat", "a beige trench coat", "a belted trench coat"),
    "abrigo": ("a coat", "a wool coat", "an overcoat", "a long winter coat"),
    "parka": ("a parka", "a hooded parka with fur trim", "a winter parka"),
    "plumifero": ("a puffer jacket", "a down jacket", "a quilted puffer coat"),
    "impermeable": ("a raincoat", "a rain jacket", "a waterproof jacket", "a windbreaker"),
    "chaleco_acolchado": ("a puffer vest", "a quilted vest", "a padded gilet", "a down vest"),
    "chaqueta_deportiva": ("a track jacket", "a zip-up athletic jacket", "a fleece jacket", "a sports jacket"),
    # --- footwear
    "zapatillas": ("sneakers", "casual sneakers", "white leather sneakers", "trainers"),
    "zapatillas_lona": ("canvas sneakers", "canvas shoes", "high top canvas sneakers"),
    "zapatillas_running": ("running shoes", "athletic running sneakers", "training shoes"),
    "botas": ("boots", "knee-high boots", "tall boots", "hiking boots"),
    "botines": ("ankle boots", "chelsea boots", "booties"),
    "zapatos": ("oxford shoes", "derby shoes", "leather dress shoes", "brogues"),
    "mocasines": ("loafers", "penny loafers", "moccasins", "boat shoes"),
    "tacones": ("high heels", "pumps", "stiletto heels", "high-heeled shoes"),
    "bailarinas": ("ballet flats", "ballerina flats", "flat ballerina shoes"),
    "sandalias": ("sandals", "strappy sandals", "flip flops", "slide sandals"),
    "alpargatas": ("espadrilles", "jute sole espadrilles", "canvas espadrilles"),
    # --- accessory
    "bolso": ("a handbag", "a purse", "a shoulder bag", "a tote bag", "a crossbody bag", "a clutch bag"),
    "mochila": ("a backpack", "a rucksack", "a school backpack"),
    "cinturon": ("a belt", "a leather belt", "a belt with buckle"),
    "bufanda": ("a scarf", "a knit scarf", "a wool winter scarf"),
    "panuelo": ("a silk scarf", "a bandana", "a neckerchief", "a printed square scarf"),
    "corbata": ("a necktie", "a tie", "a bow tie"),
    "gorro": ("a beanie", "a knit hat", "a wool winter hat"),
    "gorra": ("a baseball cap", "a cap", "a trucker cap"),
    "sombrero": ("a hat", "a fedora", "a straw hat", "a sun hat", "a bucket hat"),
    "gafas_sol": ("sunglasses", "a pair of sunglasses"),
    "reloj": ("a wristwatch", "a watch", "an analog wrist watch"),
    "joyeria": ("jewelry", "a necklace", "earrings", "a bracelet", "a ring"),
    "guantes": ("gloves", "a pair of gloves", "leather gloves", "mittens"),
    "paraguas": ("an umbrella", "a folding umbrella"),
    # --- swimwear
    "banador": ("a swimsuit", "a one-piece swimsuit", "swim trunks", "board shorts swimwear"),
    "bikini": ("a bikini", "a two-piece bikini swimsuit"),
}

# Internal reject classes: they compete in the garment softmax so that non-garment
# crops (body parts, whole people, scenes, documents…) get no category. Their summed
# probability is ``not_garment``. They are never output as attributes.
NOT_GARMENT_PREFIX = "__not_garment__"
NOT_GARMENT_PROMPTS: dict[str, tuple[str, ...]] = {
    "__not_garment__person": (
        "a full-length photo of a person",
        "a person standing",
        "a full body photo of a person wearing an outfit",
        "a photo of a person's face",
        "a portrait of a person",
    ),
    "__not_garment__body": (
        "bare legs",
        "bare human skin",
        "a person's bare arm",
        "human hair",
        "a hairstyle",
        "bare thighs",
        "a hand",
    ),
    "__not_garment__animal": ("a photo of an animal", "a dog", "a cat"),
    "__not_garment__scene": (
        "a landscape photo",
        "a photo of furniture",
        "an empty room",
        "a photo of a car",
        "a wall",
        "a curtain",
        "a bed sheet",
    ),
    "__not_garment__document": ("a document or a receipt with text", "a screenshot of a phone screen", "a logo"),
    "__not_garment__food": ("a photo of food", "a drink"),
    "__not_garment__blank": ("a blank white background", "an empty white image"),
}


def is_reject(class_id: str) -> bool:
    return class_id.startswith(NOT_GARMENT_PREFIX)


PATTERN_TEMPLATES: tuple[str, ...] = ("{}", "a garment with {}", "a close-up of fabric with {}", "clothing with {}")
PATTERN_PROMPTS: dict[str, tuple[str, ...]] = {
    "liso": ("a plain solid color", "no pattern, solid colour", "a plain single-colour fabric"),
    "rayas": ("stripes", "horizontal stripes", "vertical pinstripes", "a striped pattern"),
    "cuadros": ("a plaid pattern", "a checked pattern", "tartan", "gingham check"),
    "pata_de_gallo": ("a houndstooth pattern", "houndstooth check"),
    "espiguilla": ("a herringbone pattern", "herringbone tweed weave"),
    "lunares": ("polka dots", "a polka dot pattern"),
    "floral": ("a floral print", "a flower pattern", "printed flowers"),
    "animal": ("a leopard print", "an animal print", "a zebra print", "a snakeskin print"),
    "geometrico": ("a geometric pattern", "a geometric print"),
    "cachemir": ("a paisley pattern", "a paisley print"),
    "camuflaje": ("a camouflage pattern", "a camo print"),
    "grafico": ("a graphic print", "a large logo print", "printed text and graphics", "a printed illustration"),
    "tie_dye": ("a tie-dye pattern", "tie dye"),
    "abstracto": ("an abstract print", "an abstract pattern"),
}

MATERIAL_TEMPLATES: tuple[str, ...] = ("a garment made of {}", "{} fabric", "a close-up of {} texture")
MATERIAL_PROMPTS: dict[str, tuple[str, ...]] = {
    "algodon": ("cotton", "cotton jersey"),
    "lino": ("linen", "wrinkled linen"),
    "lana": ("wool", "wool felt"),
    "cachemira": ("cashmere",),
    "seda": ("silk",),
    "saten": ("satin", "shiny satin"),
    "poliester": ("polyester",),
    "viscosa": ("viscose rayon",),
    "denim": ("denim", "blue denim twill"),
    "punto": ("knitwear", "knitted yarn", "chunky knit"),
    "pana": ("corduroy", "ribbed corduroy"),
    "tweed": ("tweed",),
    "cuero": ("leather", "smooth leather"),
    "ante": ("suede",),
    "lona": ("canvas",),
    "tecnico": ("technical performance fabric", "breathable sports mesh"),
    "plumon": ("down padding", "quilted down filling"),
    "nailon": ("nylon", "shiny nylon"),
    "sintetico": ("synthetic fabric", "faux leather"),
    "terciopelo": ("velvet",),
}
# Materials a camera can plausibly tell apart. The rest (algodón vs poliéster vs
# viscosa…) are never emitted from pixels alone — they compete in the softmax
# only to soak up probability mass. See docs/vision.md.
VISUAL_MATERIALS: frozenset[str] = frozenset(
    {"denim", "punto", "pana", "cuero", "ante", "lona", "plumon", "terciopelo", "saten", "tweed"}
)

STYLE_TEMPLATES: tuple[str, ...] = ("{}", "a garment in {} style", "{} fashion")
STYLE_PROMPTS: dict[str, tuple[str, ...]] = {
    "casual": ("casual everyday clothing",),
    "formal": ("formal business attire", "formalwear"),
    "deportivo": ("sportswear", "athletic gym clothing"),
    "streetwear": ("streetwear", "urban hip hop clothing"),
    "elegante": ("elegant chic clothing", "sophisticated evening fashion"),
    "minimalista": ("minimalist clothing", "clean minimal design"),
    "clasico": ("classic timeless clothing",),
    "bohemio": ("bohemian boho clothing",),
    "romantico": ("romantic feminine clothing with ruffles and lace",),
    "rockero": ("rock style clothing", "punk rock fashion"),
    "preppy": ("preppy clothing", "ivy league fashion"),
    "vintage": ("vintage retro clothing",),
    "utilitario": ("utility workwear clothing", "military cargo style"),
    "athleisure": ("athleisure clothing", "comfortable sporty loungewear"),
}

WARMTH_TEMPLATES: tuple[str, ...] = ("{}", "a photo of {}")
WARMTH_PROMPTS: dict[str, tuple[str, ...]] = {
    "light": ("a lightweight summer garment", "thin breathable clothing for hot weather"),
    "mid": ("a mid-weight garment for spring and autumn", "a light layer for mild weather"),
    "heavy": ("a heavy warm winter garment", "thick insulated clothing for cold weather"),
}
WARMTH_SEASONS: dict[str, tuple[str, ...]] = {
    "light": ("primavera", "verano"),
    "mid": ("primavera", "otono"),
    "heavy": ("otono", "invierno"),
}

FIT_TEMPLATES: tuple[str, ...] = ("{}", "a photo of {}")
FIT_PROMPTS: dict[str, tuple[str, ...]] = {
    "ajustado": ("a slim fit tight garment", "skinny fit clothing"),
    "regular": ("a regular fit garment", "classic straight fit clothing"),
    "holgado": ("a loose relaxed fit garment", "wide leg relaxed clothing"),
    "oversize": ("an oversized baggy garment", "oversize fit clothing"),
}

SCENE_TEMPLATES: tuple[str, ...] = ("{}",)
SCENE_PROMPTS: dict[str, tuple[str, ...]] = {
    "worn": (
        "a photo of a person wearing an outfit",
        "a mirror selfie of a person showing their outfit",
        "a model posing in clothes",
        "a street style photo of a person",
    ),
    "multiple": (
        "a flat lay of several clothes and accessories",
        "several garments laid out on a bed",
        "a collection of different clothing items on the floor",
    ),
    "single": (
        "a product photo of a single garment on a plain background",
        "a single piece of clothing laid flat",
        "a garment hanging on a hanger",
        "a pair of shoes on a white background",
        "a single accessory product photo",
    ),
}

# Open-vocabulary detector queries (multi mode / worn photos). Garments only — never
# "person". Kept short and coarse on purpose: Grounding DINO attributes labels
# poorly with long prompts, and the fine-grained label comes from FashionSigLIP.
DETECTION_QUERIES: tuple[str, ...] = (
    "t-shirt", "shirt", "sweater", "hoodie", "jacket", "coat", "dress", "jumpsuit", "trousers", "jeans",
    "shorts", "skirt", "shoe", "sneaker", "boot", "sandal", "bag", "backpack", "hat", "cap", "scarf", "belt",
    "sunglasses",
)
# Noun → coarse group, used to parse detector labels (which may be multi-word phrases).
DETECTION_GROUPS: tuple[tuple[str, str], ...] = (
    ("t-shirt", "top"), ("t - shirt", "top"), ("shirt", "top"), ("blouse", "top"), ("sweater", "top"),
    ("hoodie", "top"), ("cardigan", "top"), ("jacket", "outer"), ("coat", "outer"), ("blazer", "outer"),
    ("vest", "outer"), ("dress", "one_piece"), ("jumpsuit", "one_piece"), ("swimsuit", "one_piece"),
    ("trousers", "bottom"), ("jeans", "bottom"), ("shorts", "bottom"), ("skirt", "bottom"), ("leggings", "bottom"),
    ("sneaker", "footwear"), ("shoe", "footwear"), ("boot", "footwear"), ("sandal", "footwear"), ("heel", "footwear"),
    ("backpack", "bag"), ("bag", "bag"), ("hat", "head"), ("cap", "head"), ("scarf", "neck"), ("belt", "waist"),
    ("sunglasses", "eyes"), ("glove", "hands"),
)
PAIRED_GROUPS = frozenset({"footwear", "hands"})

# Display supports that background removal keeps together with the garment (single
# mode). Detector proposals only: every proposed region is verified by FashionSigLIP
# (``SUPPORT_PROMPTS`` vs. garments and garment parts) before anything is removed.
# Closed list of objects — never "person" or "face".
PROP_QUERIES: tuple[str, ...] = ("clothes hanger", "mannequin", "mannequin head", "clothesline", "clothespin", "hook")
SUPPORT_PROMPTS: dict[str, tuple[str, ...]] = {
    "__support__hanger": ("a clothes hanger", "a wooden coat hanger", "a metal wire hanger", "a plastic hanger hook"),
    "__support__mannequin": (
        "a mannequin head", "a mannequin", "a dress form", "a styrofoam wig head", "a display bust", "a mannequin torso",
    ),
    "__support__line": ("a clothesline", "a rope", "a string", "a thin wire"),
    "__support__peg": ("a clothespin", "a clothes peg", "a metal hook", "a hook on a wall", "a display stand"),
    # Hat forms under a cap or beanie look like a hat to the model unless described plainly.
    "__support__form": (
        "a smooth featureless beige form", "a plain white plastic object", "a blank mannequin head with no face",
        "a smooth cone-shaped stand", "a lampshade",
    ),
}
# Parts of garments that look like supports (straps, chains, laces…): they compete with
# the support classes so a bag chain or a shoelace is never taken for a clothesline.
GARMENT_PART_PROMPTS: dict[str, tuple[str, ...]] = {
    "__part__strap": (
        "the chain strap of a handbag", "a bag handle", "a shoulder strap", "a leather strap", "a backpack strap",
        "a metal buckle of a bag", "a metal ring of a bag handle",
    ),
    "__part__cord": ("a shoelace", "a drawstring cord of a hoodie", "a zipper pull", "a belt buckle", "a tassel", "a ribbon bow"),
    "__part__piece": ("a sleeve of a garment", "a piece of fabric", "a knitted fabric", "a pocket", "a collar", "a label tag"),
}
SUPPORT_TEMPLATES: tuple[str, ...] = ("{}", "a photo of {}")


def ensemble(names: tuple[str, ...], templates: tuple[str, ...]) -> list[str]:
    return [t.format(n) for n in names for t in templates]


# ---------------------------------------------------------------------------
# Spanish → English query rewriting for text-to-image search
# ---------------------------------------------------------------------------

# Garment nouns (Spanish label tokens and common synonyms) → English.
_GARMENT_ES: dict[str, str] = {
    "camiseta": "t-shirt", "camisetas": "t-shirt", "camiseta de manga larga": "long sleeve t-shirt",
    "camiseta tecnica": "sports t-shirt", "polo": "polo shirt", "camisa": "shirt", "camisa de manga corta": "short sleeve shirt",
    "sobrecamisa": "overshirt", "blusa": "blouse", "top": "top", "body": "bodysuit", "jersey": "sweater",
    "jersey grueso": "chunky knit sweater", "sueter": "sweater", "jersei": "sweater", "sudadera": "sweatshirt",
    "sudadera con capucha": "hoodie", "cardigan": "cardigan", "rebeca": "cardigan", "chaleco de punto": "sweater vest",
    "pantalon": "trousers", "pantalones": "trousers", "pantalon de vestir": "dress pants", "vaquero": "jeans",
    "vaqueros": "jeans", "tejanos": "jeans", "jeans": "jeans", "chino": "chinos", "chinos": "chinos",
    "pantalon corto": "shorts", "shorts": "shorts", "bermuda": "bermuda shorts", "bermudas": "bermuda shorts",
    "falda": "skirt", "minifalda": "mini skirt", "falda larga": "maxi skirt", "leggings": "leggings", "mallas": "leggings",
    "jogger": "jogger pants", "joggers": "jogger pants", "pantalon de chandal": "sweatpants",
    "pantalon corto deportivo": "athletic shorts", "vestido": "dress", "vestidos": "dress", "vestido de punto": "knit dress",
    "vestido de fiesta": "evening dress", "mono": "jumpsuit", "peto": "overalls", "chandal": "tracksuit",
    "americana": "blazer", "blazer": "blazer", "chaqueta": "jacket", "chaquetas": "jacket", "cazadora": "jacket",
    "cazadora vaquera": "denim jacket", "chaqueta vaquera": "denim jacket", "chaqueta de cuero": "leather jacket",
    "cazadora de cuero": "leather jacket", "bomber": "bomber jacket", "gabardina": "trench coat", "trench": "trench coat",
    "abrigo": "coat", "abrigos": "coat", "parka": "parka", "plumifero": "puffer jacket", "plumas": "puffer jacket",
    "chubasquero": "raincoat", "impermeable": "raincoat", "chaleco acolchado": "puffer vest", "chaleco": "vest",
    "chaqueta deportiva": "track jacket", "zapatillas": "sneakers", "deportivas": "sneakers",
    "zapatillas de lona": "canvas sneakers", "zapatillas de running": "running shoes", "botas": "boots", "bota": "boots",
    "botines": "ankle boots", "botin": "ankle boots", "zapatos": "shoes", "zapato": "shoes", "mocasines": "loafers",
    "mocasin": "loafers", "tacones": "high heels", "zapatos de tacon": "high heels", "bailarinas": "ballet flats",
    "manoletinas": "ballet flats", "sandalias": "sandals", "chanclas": "flip flops", "alpargatas": "espadrilles",
    "bolso": "handbag", "bolsos": "handbag", "mochila": "backpack", "cinturon": "belt", "bufanda": "scarf",
    "panuelo": "silk scarf", "fular": "scarf", "corbata": "necktie", "pajarita": "bow tie", "gorro": "beanie",
    "gorra": "baseball cap", "sombrero": "hat", "gafas de sol": "sunglasses", "gafas": "glasses", "reloj": "watch",
    "joyeria": "jewelry", "collar": "necklace", "pendientes": "earrings", "pulsera": "bracelet", "anillo": "ring",
    "guantes": "gloves", "paraguas": "umbrella", "banador": "swimsuit", "bikini": "bikini", "traje": "suit",
    "prenda": "garment", "prendas": "garment", "ropa": "clothes",
}

_COLOR_ES: dict[str, str] = {
    "negro": "black", "negra": "black", "negros": "black", "negras": "black", "antracita": "charcoal grey", "gris antracita": "charcoal grey",
    "gris": "grey", "grises": "grey", "marengo": "dark grey", "blanco": "white", "blanca": "white", "blancos": "white",
    "blancas": "white", "crudo": "ecru off-white", "cruda": "ecru off-white", "marfil": "ivory", "hueso": "off-white",
    "beige": "beige", "arena": "sand beige", "piedra": "stone beige", "camel": "camel", "marron": "brown",
    "marrones": "brown", "chocolate": "chocolate brown", "azul marino": "navy blue", "marino": "navy blue",
    "denim": "denim blue", "azul": "blue", "azules": "blue", "celeste": "light blue", "azul claro": "light blue",
    "turquesa": "turquoise", "verde": "green", "verdes": "green", "verde oliva": "olive green", "oliva": "olive green",
    "caqui": "khaki", "kaki": "khaki", "menta": "mint green", "verde menta": "mint green", "amarillo": "yellow",
    "amarilla": "yellow", "mostaza": "mustard yellow", "naranja": "orange", "coral": "coral", "terracota": "terracotta",
    "teja": "rust", "rojo": "red", "roja": "red", "rojos": "red", "burdeos": "burgundy", "granate": "burgundy",
    "rosa": "pink", "rosas": "pink", "fucsia": "fuchsia", "lila": "lilac", "malva": "mauve", "lavanda": "lavender",
    "morado": "purple", "morada": "purple", "dorado": "gold", "dorada": "gold", "plateado": "silver", "plateada": "silver",
}

_PATTERN_ES: dict[str, str] = {
    "liso": "plain", "lisa": "plain", "rayas": "striped", "a rayas": "striped", "de rayas": "striped",
    "cuadros": "plaid", "a cuadros": "plaid", "de cuadros": "plaid", "pata de gallo": "houndstooth",
    "espiguilla": "herringbone", "lunares": "polka dot", "de lunares": "polka dot", "floral": "floral",
    "flores": "floral", "de flores": "floral", "estampado": "printed", "animal print": "animal print",
    "leopardo": "leopard print", "cebra": "zebra print", "geometrico": "geometric", "cachemir": "paisley",
    "camuflaje": "camouflage", "tie dye": "tie-dye", "abstracto": "abstract", "logo": "logo",
}

_MATERIAL_ES: dict[str, str] = {
    "algodon": "cotton", "lino": "linen", "lana": "wool", "cachemira": "cashmere", "seda": "silk", "saten": "satin",
    "poliester": "polyester", "viscosa": "viscose", "punto": "knit", "pana": "corduroy", "tweed": "tweed",
    "cuero": "leather", "piel": "leather", "polipiel": "faux leather", "ante": "suede", "lona": "canvas",
    "plumon": "down", "nailon": "nylon", "nylon": "nylon", "terciopelo": "velvet", "vaquera": "denim", "punto grueso": "chunky knit",
}

_MODIFIER_ES: dict[str, str] = {
    "manga corta": "short sleeve", "manga larga": "long sleeve", "sin mangas": "sleeveless", "corto": "short",
    "corta": "short", "largo": "long", "larga": "long", "oversize": "oversized", "ajustado": "slim fit",
    "ajustada": "slim fit", "holgado": "loose fit", "holgada": "loose fit", "ancho": "wide leg", "anchos": "wide leg",
    "pitillo": "skinny", "cuello alto": "turtleneck", "cuello vuelto": "turtleneck", "capucha": "hooded",
    "con capucha": "hooded", "acolchado": "quilted", "acolchada": "quilted", "deportivo": "sports", "deportiva": "sports",
    "fiesta": "party", "elegante": "elegant", "formal": "formal", "casual": "casual", "verano": "summer",
    "invierno": "winter", "mujer": "women's", "hombre": "men's", "nino": "kids", "nina": "girls", "vintage": "vintage",
    "basico": "basic", "basica": "basic", "midi": "midi", "maxi": "maxi", "mini": "mini", "plisada": "pleated",
    "plisado": "pleated", "tiro alto": "high waisted", "botones": "buttoned", "cremallera": "zip", "tirantes": "strappy",
}

_STOPWORDS = frozenset({"de", "del", "con", "y", "a", "para", "en", "el", "la", "los", "las", "un", "una", "mi", "mis"})


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9ñ\- ]+", " ", text)).strip().replace("ñ", "n")


@lru_cache(maxsize=1)
def _glossary() -> list[tuple[tuple[str, ...], str, str]]:
    """``[(spanish_tokens, english, kind)]`` sorted longest-first for greedy matching."""
    entries: dict[str, tuple[str, str]] = {}
    vocab = load_vocabulary()
    # Vocabulary labels (e.g. "Pantalón de vestir") map to the first English synonym of the id.
    for sub in vocab.subcategories:
        prompts = SUBCATEGORY_PROMPTS.get(sub.id)
        if not prompts:
            continue
        english = re.sub(r"^(a|an) ", "", prompts[0])
        for part in sub.label.split("/"):
            entries.setdefault(_norm(part), (english, "garment"))
    for table, kind in ((_GARMENT_ES, "garment"), (_COLOR_ES, "color"), (_PATTERN_ES, "pattern"),
                        (_MATERIAL_ES, "material"), (_MODIFIER_ES, "modifier")):
        for es, en in table.items():
            entries[_norm(es)] = (en, kind)
    for fam in vocab.color_families:
        entries.setdefault(_norm(fam.label), (_COLOR_ES.get(_norm(fam.label), fam.label.lower()), "color"))
    out = [(tuple(k.split()), en, kind) for k, (en, kind) in entries.items() if k]
    out.sort(key=lambda e: len(e[0]), reverse=True)
    return out


def translate_query(text: str) -> str:
    """Rewrite a (possibly Spanish) fashion query into an English product-style phrase.

    Greedy longest-match over the glossary; Spanish noun–adjective order is turned
    into English adjective–noun order ("chaqueta beige" → "beige jacket").
    Unknown tokens are kept verbatim, so English queries pass through unchanged.
    """
    tokens = _norm(text).split()
    if not tokens:
        return text.strip()
    glossary = _glossary()
    buckets: dict[str, list[str]] = {"modifier": [], "color": [], "pattern": [], "material": [], "garment": [], "other": []}
    matched_any = False
    i = 0
    while i < len(tokens):
        hit = None
        for es_tokens, en, kind in glossary:
            n = len(es_tokens)
            if tuple(tokens[i : i + n]) == es_tokens:
                hit = (n, en, kind)
                break
        if hit is None and tokens[i].endswith("s"):  # naive plural fallback
            for es_tokens, en, kind in glossary:
                if len(es_tokens) == 1 and es_tokens[0] in (tokens[i][:-1], tokens[i][:-2]):
                    hit = (1, en, kind)
                    break
        if hit:
            n, en, kind = hit
            buckets[kind].append(en)
            matched_any = True
            i += n
        else:
            if tokens[i] not in _STOPWORDS:
                buckets["other"].append(tokens[i])
            i += 1
    if not matched_any:
        return text.strip()
    if buckets["material"] == ["denim"] and any("jacket" in g or "jeans" in g for g in buckets["garment"]):
        buckets["material"] = []  # "cazadora vaquera" already says denim
    parts = buckets["modifier"] + buckets["color"] + buckets["pattern"] + buckets["material"] + buckets["other"] + buckets["garment"]
    return " ".join(dict.fromkeys(" ".join(parts).split(" "))).strip() if parts else text.strip()
