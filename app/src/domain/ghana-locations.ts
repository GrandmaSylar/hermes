/**
 * Ghana's 16 regions and the towns in each, copied from the core banking app's registration form.
 * The city is free text on the form: this list only suggests names, any place can be typed in.
 */

export const REGIONS: string[] = [
  'Ahafo',
  'Ashanti',
  'Bono',
  'Bono East',
  'Central',
  'Eastern',
  'Greater Accra',
  'North East',
  'Northern',
  'Oti',
  'Savannah',
  'Upper East',
  'Upper West',
  'Volta',
  'Western',
  'Western North'
];

export const CITIES_BY_REGION: Record<string, string[]> = {
  'Ahafo': [
    'Goaso', 'Duayaw Nkwanta', 'Bechem', 'Kenyasi', 'Kenyasi No. 1', 'Kenyasi No. 2',
    'Hwidiem', 'Mim', 'Kukuom', 'Achefiri', 'Akrodie', 'Ayomso', 'Dadiesoaba',
    'Dantano', 'Derma', 'Esaretese', 'Gambia', 'Kasapin', 'Kortokrom', 'Mehame',
    'Ntotroso', 'Sankore', 'Seikwa', 'Tanoso', 'Tepa', 'Yamfo', 'Acherensua',
    'Fawohoyeden', 'Kokofu', 'Kwakuanya', 'Nsutam', 'Nkaseim', 'Terchire', 'Wamahinso'
  ],
  'Ashanti': [
    'Kumasi', 'Obuasi', 'Ejura', 'Mampong', 'Bekwai', 'Effiduase', 'Agogo', 'Konongo',
    'Juaso', 'Ejisu', 'Offinso', 'Tepa', 'Kenyasi', 'Abofour', 'Abuakwa', 'Adansi Asokwa',
    'Adenasi', 'Adiebeba', 'Adum', 'Agona', 'Ahodwo', 'Akokoaso', 'Akrokerri',
    'Antoa', 'Anyinasusu', 'Asante Akropong', 'Asawasi', 'Asokore Mampong', 'Asokwa',
    'Atasomanso', 'Atimatim', 'Ayigya', 'Bantama', 'Bare-Kese', 'Bomso',
    'Danyame', 'Dompoase', 'Dromankese', 'Duampompo', 'Edubiase', 'New Edubiase',
    'Ejisuman', 'Fomena', 'Gyasikrom', 'Jacobu', 'Juaben', 'Kodie', 'Kokofu',
    'Kotei', 'Kwamang', 'Kwamo', 'Kwadaso', 'Mamponteng', 'Manso Nkwanta', 'Nkawie',
    'Nkoranza', 'Nkwantakese', 'Nyinahin', 'Pankrono', 'Santasi',
    'Suame', 'Tafo', 'Trede', 'Winsa', 'Aboaso', 'Afrancho', 'Ahenkro', 'Ahwiaa',
    'Akwasiho', 'Amakom', 'Anwiankwanta', 'Asokore', 'Barekese', 'Bibiani',
    'Boadi', 'Bodwesango', 'Buoho', 'Deduako', 'Emena', 'Feyiase', 'Fumesua',
    'Kwabre', 'Mankranso', 'New Tafo', 'Ntonso', 'Oyoko', 'Patasi', 'Sekyedumase',
    'Tafo Nhyiaeso', 'Wiamoase', 'Foase'
  ],
  'Bono': [
    'Sunyani', 'Berekum', 'Dormaa Ahenkro', 'Wenchi', 'Nsoatre', 'Sampa', 'Duayaw Nkwanta',
    'Abesim', 'Adamsu', 'Akotuakrom', 'Amoma', 'Awiam', 'Badu', 'Banda Ahenkro',
    'Chiraa', 'Dormaa Akwamu', 'Drobo', 'Dwenem', 'Fiapre', 'Jinijini', 'Juataso',
    'Kwatire', 'Namasua', 'Nisanso', 'Nkrankwanta', 'Nsawkaw', 'Odumase',
    'Seikwa', 'Sunyani West', 'Kato', 'Kwameseikrom', 'Mehame', 'Menji',
    'Nchiraa', 'New Dormaa', 'Suma Ahenkro', 'Tanoso', 'Tuobodom', 'Yawhima'
  ],
  'Bono East': [
    'Techiman', 'Atebubu', 'Kintampo', 'Nkoranza', 'Yeji', 'Prang', 'Abofere',
    'Amantin', 'Bamboi', 'Busunya', 'Donkorkrom', 'Dromankese', 'Forikrom',
    'Garampah', 'Jema', 'Kajeji', 'Kintampo No. 1', 'Kintampo No. 2',
    'Kwame Danso', 'Nyomoase', 'Pinihi', 'Tuobodom', 'Akomadan', 'Apesika',
    'Kokrompe', 'Kranka', 'New Longoro', 'Offuman', 'Sankore', 'Tanoboase',
    'Techira', 'Tuluwe', 'Zabrama'
  ],
  'Central': [
    'Cape Coast', 'Kasoa', 'Assin Fosu', 'Mankessim', 'Elmina', 'Dunkwa-on-Offin',
    'Agona Swedru', 'Winneba', 'Saltpond', 'Apam', 'Abura Dunkwa', 'Assin Manso',
    'Ayamfuri', 'Bawjiase', 'Besease', 'Breman Asikuma', 'Buduburam', 'Diaso',
    'Dominase', 'Enyan Mim', 'Foso', 'Gomoa Potsin', 'Hemang',
    'Komenda', 'Moree', 'Mumford', 'Nyakrom', 'Nyanyano', 'Obrakyere',
    'Odupon-Kpehe', 'Senya Beraku', 'Twifo Praso', 'Abakrampa', 'Ajumako',
    'Anomabo', 'Assin Bereku', 'Baifikrom', 'Biriwa', 'Breman Essiam',
    'Bronibima', 'Ekumfi Narkwa', 'Gomoa Dawurampong', 'Jukwa', 'Kissi',
    'Nsaba', 'Ochiso', 'Otuam', 'Pomadze', 'Swedru', 'Tarkwa Breman'
  ],
  'Eastern': [
    'Koforidua', 'Akwatia', 'Suhum', 'Nkawkaw', 'Akyem Oda', 'Asamankese', 'Kade',
    'New Tafo', 'Mpraeso', 'Begoro', 'Somanya', 'Abetifi', 'Aburi', 'Adeiso',
    'Adukrom', 'Agomanya', 'Akropong', 'Akosombo', 'Akyem Swedru',
    'Anyinam', 'Asesewa', 'Atimpoku', 'Donkorkrom', 'Enyiresi', 'Frankadua', 'Kibi',
    'Kpong', 'Kukurantumi', 'Kwabeng', 'Mamfe', 'Mampong',
    'Nsawam', 'Osino', 'Oterkpolu', 'Pease', 'Tafo', 'Achiase', 'Akim Oda',
    'Amanase', 'Apedwa', 'Asafo', 'Asuboi', 'Ayikuma', 'Bunso', 'Coaltar',
    'Effiduase', 'Kwahu Tafo', 'Kyebi', 'Maame Krobo', 'Nankese', 'Nkurakan',
    'Obo Kwahu', 'Odumase Krobo', 'Osiem', 'Suminakese', 'Twifo', 'Ofoase'
  ],
  'Greater Accra': [
    'Accra', 'Tema', 'Ashaiman', 'Madina', 'Dome', 'Gbawe', 'Lashibi', 'Taifa',
    'Awoshie', 'Adenta', 'Sakumono', 'Teshie', 'Nungua', 'Dansoman', 'Kasoa',
    'Abokobi', 'Achimota', 'Ada Foah', 'Amasaman', 'Ashaley Botwe',
    'Big Ada', 'Cantonments', 'Chorkor', 'Darkuman', 'Dodowa',
    'Haatso', 'James Town', 'Kaneshie', 'Korle Gonno', 'Labadi', 'Lapaz', 'Legon',
    'Mamprobi', 'Nima', 'Oblogo', 'Odorkor', 'Old Ningo', 'Osu', 'Oyibi', 'Pokuase',
    'Prampram', 'Sowutuom', 'Spintex', 'Sukura', 'Tabora', 'Teiman', 'Weija',
    'Abeka', 'Ablekuma', 'Accra New Town', 'Adabraka', 'Afienya', 'Agbogbloshie',
    'Airport Residential', 'Alajo', 'Ashiedu Keteke', 'Baatsona', 'Bortianor',
    'Bubuashie', 'Dansoman Estates', 'Dawhenya', 'Dzorwulu', 'East Legon',
    'Kokrobite', 'Kpone', 'Kwabenya', 'La', 'Labone', 'Mallam', 'McCarthy Hill',
    'Michel Camp', 'North Kaneshie', 'Ofankor', 'Ridge', 'Roman Ridge', 'Santa Maria',
    'Sege', 'Shai Hills', 'Tema Community 1', 'Tema Community 25', 'Tesano',
    'Tudu', 'West Legon', 'Kwashieman'
  ],
  'North East': [
    'Nalerigu', 'Walewale', 'Gambaga', 'Bunkpurugu', 'Chereponi', 'Janga', 'Langbinsi',
    'Nakpanduri', 'Nasia', 'Wulugu', 'Yunyoo', 'Gbintiri', 'Kpasenkpe',
    'Loagri', 'Mamprugu', 'Sakogu', 'Wungu', 'Zangum'
  ],
  'Northern': [
    'Tamale', 'Savelugu', 'Bimbilla', 'Yendi', 'Tolon', 'Gushegu', 'Karaga',
    'Chamba', 'Daboya', 'Kpandai', 'Kumbungu',
    'Nanton', 'Saboba', 'Sang', 'Tatale', 'Wulensi', 'Zabzugu', 'Bole',
    'Choggu', 'Diare', 'Gbullo', 'Kasuliyili', 'Kpalbe', 'Kpasa', 'Lamashegu',
    'Nyankpala', 'Pong Tamale', 'Sagnarigu', 'Salaga', 'Sanguli', 'Tampion',
    'Wapuli', 'Yapei', 'Zabzugu Tatale'
  ],
  'Oti': [
    'Dambai', 'Kete Krachi', 'Nkwanta', 'Jasikan', 'Kadjebi', 'Ahamansu', 'Asukawkaw',
    'Chinderi', 'Dutukpene', 'Krachi Nchumuru', 'Likpe Mate',
    'Likpe Todome', 'Nkonya Ahenkro', 'Tapa Abotoase', 'Worawora', 'Baglo',
    'Brewaniase', 'Buem', 'Guaman', 'Kpassa', 'Menusu', 'New Ayoma', 'Papase',
    'Santrokofi', 'Sibi', 'Tutukpene'
  ],
  'Savannah': [
    'Damongo', 'Bole', 'Salaga', 'Sawla', 'Buipe', 'Bamboi', 'Daboya',
    'Fufulso', 'Mpaha', 'Tuna', 'Yapei', 'Busunu', 'Kpalbe', 'Kunfosi',
    'Larabanga', 'Makango', 'Mankuma', 'Murugu', 'Sawla-Tuna-Kalba', 'Sori',
    'Tinga', 'Yagbonwura'
  ],
  'Upper East': [
    'Bolgatanga', 'Bawku', 'Paga', 'Navrongo', 'Bongo', 'Zebilla', 'Binaba',
    'Chiana', 'Fumbisi', 'Garu', 'Kandiga', 'Kologo',
    'Pusiga', 'Sandema', 'Sirigu', 'Tempane', 'Tongo', 'Widana', 'Bawku West',
    'Bolga', 'Doba', 'Gowrie', 'Kanga', 'Kongo', 'Manga', 'Nangodi', 'Pwalugu',
    'Sapeliga', 'Tilli', 'Vea', 'Winkogo', 'Zuarungu', 'Zorko'
  ],
  'Upper West': [
    'Wa', 'Tumu', 'Nadowli', 'Lawra', 'Jirapa', 'Busie', 'Funsi', 'Gwollu',
    'Hamile', 'Issa', 'Kaleo', 'Lambussie', 'Nandom', 'Pina', 'Wechiau',
    'Babile', 'Charia', 'Daffiama', 'Dorimon', 'Eremon', 'Fielmuo', 'Ko',
    'Kojokperi', 'Lassia Tuolu', 'Piina', 'Sombo', 'Ullo', 'Wa East',
    'Wa West'
  ],
  'Volta': [
    'Ho', 'Hohoe', 'Akatsi', 'Aflao', 'Dzodze', 'Keta', 'Kpando', 'Sogakope', 'Denu',
    'Abutia', 'Adaklu Waya', 'Adidome', 'Agbozume', 'Anyako', 'Anloga',
    'Ave Dakpa', 'Golokwati', 'Juapong', 'Kpetoe', 'Kpoeta',
    'Leklebi', 'Peki', 'Sovie', 'Tsito', 'Vane', 'Abor', 'Adaklu', 'Afife',
    'Akrofu', 'Ave Afiadenyigba', 'Battor', 'Dabala', 'Have',
    'Ho Bankoe', 'Hodzo', 'Kalikpo', 'Klikor', 'Kpando Torkor', 'Logba',
    'Mafi Kumase', 'Matse', 'Sokode', 'Srogboe', 'Taviefe', 'Tefle', 'Ziope',
    'Adafienu', 'Akatsi South', 'Weta'
  ],
  'Western': [
    'Sekondi-Takoradi', 'Takoradi', 'Sekondi', 'Tarkwa', 'Prestea', 'Axim', 'Shama',
    'Elubo', 'Aboso', 'Agona Nkwanta', 'Aiyinase', 'Awaso', 'Bogoso', 'Bonsa',
    'Dixcove', 'Half Assini', 'Huni Valley', 'Kwesimintsim', 'Mpohor', 'Nsein',
    'Samreboi', 'Tikobo No. 1', 'Anaji', 'Apowa', 'Beahu', 'Beyin', 'Butre',
    'Cape Three Points', 'Daboase', 'Effia', 'Esiama', 'Fijai', 'Inchaban',
    'Kojokrom', 'Nkroful', 'Nzema', 'Prestea Huni Valley', 'Sefwi', 'Tanokrom',
    'Whindo', 'Wassa Akropong', 'Ahanta'
  ],
  'Western North': [
    'Sefwi Wiawso', 'Bibiani', 'Enchi', 'Juaboso', 'Asawinso', 'Adabokrom',
    'Anyinabrim', 'Bodi', 'Dadieso', 'Debiso', 'Essam', 'Akontombra', 'Asafo',
    'Awaso', 'Bekwai', 'Boako', 'Bosomoiso', 'Dwinase', 'Kaase', 'Sefwi Bekwai',
    'Sefwi Anhwiaso', 'Wiawso', 'Yawmatwa'
  ]
};

/** Towns suggested for a region, alphabetical. */
export function citiesForRegion(region: string): string[] {
  return [...new Set(CITIES_BY_REGION[region] ?? [])].sort((a, b) => a.localeCompare(b));
}
