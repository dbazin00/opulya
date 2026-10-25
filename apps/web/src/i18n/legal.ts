export const enLegal = {
  navigation: "Privacy and legal information",
  back: "Back to signup",
  acceptTerms: "I agree to the <terms>Terms of Use</terms>.",
  termsVersion: "Terms version: {version}",
  updated: "Last updated: {date}",
  draftTitle: "Draft notice: operator review pending",
  draftBody:
    "The operator's identity, contact details, retention schedule or international-transfer arrangements have not all been confirmed. These notices are not ready for a public launch. Use test data only until they are completed.",
  signupDraft:
    "Privacy details are still being finalized. Use test data only for now.",
  signupClosed:
    "Registration is paused until the operator completes the privacy setup. Existing users can still sign in.",
  signupNotice:
    "Before creating an account, read our <terms>Terms of Use</terms>, <privacy>Privacy Notice</privacy> and <security>Security Information</security>.",
  operator: "Data controller",
  contact: "Privacy and security contact",
  contactAction: "Contact the operator",
  notConfigured: "Not yet provided by the operator",
  retentionPending:
    "The operator must publish the actual retention periods for inactive and unverified accounts, security logs, email-delivery records and backup deletion before public launch.",
  transfersPending:
    "The operator must confirm the actual hosting regions, provider processing locations, applicable transfer safeguards and how to obtain a copy of those safeguards before public launch.",
  authority: "Croatian Personal Data Protection Agency (AZOP)",
  review:
    "These notices do not certify compliance with GDPR or every privacy law. Your statutory privacy and consumer rights are not waived by registration or use of Opulya.",
  privacy: {
    title: "Privacy Notice",
    intro:
      "Opulya organizes the financial records you enter manually. This notice explains the information handled by the current service, why it is needed and the choices available to you.",
    sections: {
      controller: {
        title: "Who is responsible",
        body: "The operator identified below is responsible for deciding how Opulya processes personal data. The operator may be an individual rather than a registered business. Opulya is the product name, not a separate legal entity.",
      },
      data: {
        title: "Information we handle",
        body: "We store your name, email address, password hash, verification and session records, accepted terms version and acceptance time, processing-restriction status, language and time zone. We also store the accounts, balances, categories, budgets, transactions, descriptions, investment activity and asset selections you enter. Requests expose technical information, including IP address and browser information, to the servers handling them. The app does not request your bank or broker credentials. Avoid entering other people's details or sensitive information in descriptions.",
      },
      purposes: {
        title: "Purposes and legal grounds",
        body: "Account administration, verification, storage and financial calculations are needed to provide the service you request (performance of a contract or steps requested before it). Session protection, abuse prevention and service troubleshooting support the legitimate interests of protecting users and operating a reliable service. Processing may also be necessary to meet a specific legal obligation. The operator must assess these grounds for the actual deployment. Reading this notice is not blanket consent to unrelated processing or marketing.",
      },
      providers: {
        title: "Service providers and disclosures",
        body: "The current deployment uses Vercel for the website, Render for the API, Neon for the database and Resend for verification email. These providers process the information necessary for their roles, including technical request data; Resend receives your email address, first name and verification message. Yahoo Finance receives public search queries and instrument identifiers through our server, not your private balances or transaction history. Do not put personal information in market searches. Authorized operators and providers may access data for support, security and operations. Disclosure may also be necessary to meet a lawful request. Provider contracts, access and locations require operator review.",
      },
      transfers: {
        title: "Processing locations and international transfers",
        body: "A European database region does not by itself mean all processing stays in the EEA. Hosting, email, support and market-data services may involve other countries. The operator must document any transfers and their lawful mechanism, such as an applicable adequacy decision or standard contractual clauses with any necessary additional safeguards; this notice does not establish those safeguards.",
      },
      retention: {
        title: "Retention and deletion",
        body: "Financial records remain while your account exists, including inactive verified accounts; there is no automatic financial-history deletion. Archiving, correcting or voiding records does not erase their history. Settings lets you download application data and permanently delete your user account and its financial records from the active database. Unverified registrations without a password or financial records are removed after {days} days. Expired verification-token hashes, expired or idle sessions, and expired email-abuse counters are cleaned up at startup and hourly while the API is running; cleanup resumes when a sleeping service wakes. Recipient counters expire within one day and are removed on self-service account deletion. Retention for provider-held email, technical logs, backups and any justified exceptions is specified below and requires operator handling. Backup copies are not erased by the in-app deletion button.",
      },
      storage: {
        title: "Cookies and browser storage",
        body: "A first-party session cookie authenticates you until the session expires. OPULYA_LOCALE and OPULYA_THEME remember your language and appearance choices for up to one year. Browser session storage remembers your pending verification email address and resend cooldown; it is cleared after successful verification, account deletion or when you choose another address. These are authentication and preference functions, not advertising tracking. The app currently includes no advertising cookies, third-party audience analytics or marketing-email feature. Hosting providers may separately process technical security and delivery records. Optional tracking must be assessed and, where required, consent obtained before it is introduced.",
      },
      rights: {
        title: "Your privacy rights",
        body: "Depending on the applicable law and the processing, you may request access, correction, deletion, restriction or portability of your data, and object to processing based on legitimate interests. Where processing relies on consent, you may withdraw it without affecting earlier lawful processing. Settings provides profile-name correction, a machine-readable JSON export, account deletion and a processing restriction. Restriction blocks financial views and changes but retains records; essential authentication and security processing continues. You can explicitly resume processing in Settings. For email correction, provider-held records, objections or other requests, contact the operator above; proportionate identity verification may be necessary. These controls do not limit your rights. Requests normally require a response within one month, subject to permitted extensions. You may complain to your local supervisory authority, including AZOP in Croatia.",
      },
      choices: {
        title: "Your choices and automated processing",
        body: "Registration requires your name and email address; a verified address and password are needed to sign in. You choose which financial information to enter. Without required account information, we cannot provide an account. Financial charts, budgets and portfolio calculations are informational; Opulya does not make automated lending, eligibility or trading decisions about you. There is no built-in sale-of-personal-data feature or targeted advertising.",
      },
      changes: {
        title: "Changes to this notice",
        body: "The date above identifies this notice's latest revision. Material changes to purposes, recipients or retention require an updated notice and appropriate communication before the new processing begins. Where consent is required, merely updating this page does not replace obtaining it.",
      },
    },
  },
  security: {
    title: "Security Information",
    intro:
      "Personal financial information deserves careful protection. This page describes implemented application controls and their limits, not a security certification or a guarantee that incidents cannot occur.",
    sections: {
      controls: {
        title: "Implemented safeguards",
        body: "Passwords are hashed using Argon2id rather than stored in plaintext. Only hashes of random session and verification tokens are stored. Authentication cookies are HttpOnly and use Secure in production; sessions expire and logout revokes them. The API checks ownership, validates input, applies request and email-abuse limits and rejects untrusted mutation origins. Financial operations use precise decimals and database transactions. Production HTTPS is required by the app configuration.",
      },
      access: {
        title: "Protecting your account",
        body: "Use a unique password or passphrase, protect the email account that receives verification links, and log out on shared devices. Never share passwords, session cookies or verification links. Opulya does not need access to your bank, broker or crypto-exchange login. Avoid entering those credentials in any field.",
      },
      limits: {
        title: "Important limitations",
        body: "Data is not end-to-end encrypted: authorized service operators and infrastructure providers can technically access stored information. MFA, passkeys and self-service password recovery are not implemented. Security also depends on deployment configuration, provider controls, timely patching, access management, backups and incident handling. No independent penetration test or formal OWASP certification is claimed. Do not use Opulya as your only copy of important financial records.",
      },
      reporting: {
        title: "Reporting a security issue",
        body: "Contact the operator using the privacy and security address in the Privacy Notice. Share the affected page, approximate time and a minimal reproduction, without passwords, tokens or other users' financial data. Do not access other people's accounts or perform disruptive testing. Reports do not authorize testing against hosting or other third-party services. The operator is responsible for investigating incidents and any notifications required by applicable law.",
      },
    },
  },
  terms: {
    title: "Terms of Use",
    intro:
      "These terms describe the intended use of Opulya. They do not replace the Privacy Notice or limit mandatory legal rights.",
    sections: {
      service: {
        title: "A personal recordkeeping tool",
        body: "Opulya lets you manually track accounts, transactions, budgets and investments. It is not a bank, broker, custodian or financial adviser. It does not hold money, execute payments or place trades. Nothing displayed is a recommendation to buy, sell or hold an investment.",
      },
      account: {
        title: "Responsible use",
        body: "Use an account you are authorized to operate and keep your credentials private. Do not upload unlawfully obtained personal data, attempt to bypass access controls, disrupt the service or use it for unlawful purposes. Do not provide bank or broker passwords. The service is intended for adults; it has no child-account or parental-consent workflow.",
      },
      records: {
        title: "Your records",
        body: "You remain responsible for the accuracy of entries and for checking calculations against your bank or broker statements. Keep independent copies of important records. Data entered into the service is handled as described in the Privacy Notice; these terms do not transfer ownership of your personal records to the operator.",
      },
      prices: {
        title: "Market information",
        body: "Prices can be delayed, stale, unavailable or incorrect, and exchange listings and currencies must be matched carefully. Displayed portfolio values and gains or losses are estimates, not executable trading quotes or tax reports. Consult your broker for trading and official statements. Third-party data access and redistribution remain subject to the relevant provider's terms.",
      },
      availability: {
        title: "Availability and changes",
        body: "Opulya may experience outages, errors or changes. No uninterrupted-service or price-accuracy guarantee is offered. Material changes to the service or these terms should be communicated appropriately. This is not a blanket exclusion of liability: any responsibility or remedy required by applicable law remains in place.",
      },
      rights: {
        title: "Privacy, questions and statutory rights",
        body: "Contact the operator named in the Privacy Notice with service or privacy questions, including requests to close an account. These terms do not waive privacy rights, consumer protections or rights to complain to a regulator or seek a legal remedy. No blanket consent to marketing or unrelated data processing is required to register.",
      },
    },
  },
};

export const hrLegal: typeof enLegal = {
  navigation: "Privatnost i pravne informacije",
  back: "Natrag na registraciju",
  acceptTerms: "Prihvaćam <terms>Uvjete korištenja</terms>.",
  termsVersion: "Verzija uvjeta: {version}",
  updated: "Posljednje ažuriranje: {date}",
  draftTitle: "Nacrt obavijesti: čeka se pregled voditelja",
  draftBody:
    "Identitet voditelja, kontaktni podaci, rokovi čuvanja ili uvjeti međunarodnog prijenosa još nisu u cijelosti potvrđeni. Ove obavijesti nisu spremne za javno pokretanje usluge. Do dovršetka koristite samo testne podatke.",
  signupDraft:
    "Pojedinosti o privatnosti još se dovršavaju. Zasad koristite samo testne podatke.",
  signupClosed:
    "Registracija je pauzirana dok voditelj ne dovrši postavljanje privatnosti. Postojeći korisnici i dalje se mogu prijaviti.",
  signupNotice:
    "Prije izrade računa pročitajte <terms>Uvjete korištenja</terms>, <privacy>Obavijest o privatnosti</privacy> i <security>Informacije o sigurnosti</security>.",
  operator: "Voditelj obrade",
  contact: "Kontakt za privatnost i sigurnost",
  contactAction: "Kontaktirajte voditelja",
  notConfigured: "Voditelj još nije naveo podatke",
  retentionPending:
    "Prije javnog pokretanja voditelj mora objaviti stvarne rokove čuvanja neaktivnih i nepotvrđenih računa, sigurnosnih zapisa, podataka o dostavi e-pošte i brisanja sigurnosnih kopija.",
  transfersPending:
    "Prije javnog pokretanja voditelj mora potvrditi regije hostinga, mjesta obrade kod pružatelja, primjenjive zaštitne mjere za prijenose i način dobivanja njihove kopije.",
  authority: "Agencija za zaštitu osobnih podataka (AZOP)",
  review:
    "Ove obavijesti nisu potvrda usklađenosti s GDPR-om ili svim zakonima o privatnosti. Registracijom ili korištenjem Opulye ne odričete se zakonskih prava na privatnost i zaštitu potrošača.",
  privacy: {
    title: "Obavijest o privatnosti",
    intro:
      "Opulya organizira financijske podatke koje unosite ručno. Ova obavijest opisuje koje podatke trenutačna usluga obrađuje, zašto su potrebni i koje mogućnosti imate.",
    sections: {
      controller: {
        title: "Tko je odgovoran",
        body: "Niže navedeni voditelj odgovoran je za odluke o obradi osobnih podataka u Opulyi. Voditelj može biti fizička osoba, a ne registrirana tvrtka. Opulya je naziv proizvoda, a ne zasebna pravna osoba.",
      },
      data: {
        title: "Koje podatke obrađujemo",
        body: "Pohranjujemo vaše ime, prezime, adresu e-pošte, sažetak lozinke, zapise potvrde i sesije, verziju prihvaćenih uvjeta i vrijeme prihvaćanja, status ograničenja obrade, jezik i vremensku zonu. Pohranjujemo i račune, stanja, kategorije, budžete, transakcije, opise, ulagačke aktivnosti i odabranu imovinu koje unosite. Zahtjevi poslužiteljima otkrivaju tehničke podatke, uključujući IP adresu i podatke o pregledniku. Aplikacija ne traži pristupne podatke banke ili brokera. U opise nemojte unositi podatke drugih osoba ni osjetljive informacije.",
      },
      purposes: {
        title: "Svrhe i pravne osnove",
        body: "Upravljanje računom, potvrda adrese, pohrana i financijski izračuni potrebni su za traženu uslugu (izvršavanje ugovora ili radnje na vaš zahtjev prije sklapanja ugovora). Zaštita sesije, sprečavanje zlouporabe i otklanjanje poteškoća podržavaju legitimne interese zaštite korisnika i pouzdanog rada. Obrada može biti potrebna i radi određene zakonske obveze. Voditelj mora procijeniti te osnove za stvarnu uslugu. Čitanje ove obavijesti nije opća privola za nepovezanu obradu ili marketing.",
      },
      providers: {
        title: "Pružatelji usluga i otkrivanje podataka",
        body: "Trenutačno postavljanje koristi Vercel za web-stranicu, Render za API, Neon za bazu i Resend za potvrdne poruke e-pošte. Ti pružatelji obrađuju podatke potrebne za svoju ulogu, uključujući tehničke podatke zahtjeva; Resend prima vašu adresu e-pošte, ime i potvrdnu poruku. Yahoo Finance preko našeg poslužitelja prima javne upite pretraživanja i identifikatore instrumenata, a ne vaša privatna stanja ili povijest transakcija. U tržišno pretraživanje nemojte unositi osobne podatke. Ovlašteni voditelji i pružatelji mogu pristupiti podacima radi podrške, sigurnosti i rada usluge. Otkrivanje može biti potrebno i radi zakonitog zahtjeva. Voditelj mora provjeriti ugovore, pristup i lokacije pružatelja.",
      },
      transfers: {
        title: "Lokacije obrade i međunarodni prijenosi",
        body: "Europska regija baze ne znači sama po sebi da sva obrada ostaje u EGP-u. Hosting, e-pošta, podrška i tržišni podaci mogu uključivati druge države. Voditelj mora dokumentirati prijenose i njihovu pravnu osnovu, primjerice primjenjivu odluku o primjerenosti ili standardne ugovorne klauzule uz potrebne dodatne mjere; ova obavijest sama ne uspostavlja takve mjere.",
      },
      retention: {
        title: "Čuvanje i brisanje",
        body: "Financijski zapisi ostaju dok postoji korisnički račun, uključujući neaktivne potvrđene račune; nema automatskog brisanja financijske povijesti. Arhiviranje, ispravak ili poništavanje ne brišu izvornu povijest. U Postavkama možete preuzeti podatke aplikacije i trajno izbrisati korisnički račun i njegove financijske zapise iz aktivne baze. Nepotvrđene registracije bez lozinke i financijskih zapisa brišu se nakon {days} dana. Istekli sažeci tokena potvrde, istekle ili neaktivne sesije i istekli brojači e-pošte čiste se pri pokretanju i svakih sat vremena dok API radi; čišćenje se nastavlja nakon buđenja usluge. Brojači primatelja istječu unutar jednog dana i uklanjaju se pri samostalnom brisanju računa. Čuvanje e-pošte, tehničkih zapisa i sigurnosnih kopija kod pružatelja te opravdane iznimke navedeni su ispod i zahtijevaju postupanje voditelja. Gumb za brisanje ne briše sigurnosne kopije.",
      },
      storage: {
        title: "Kolačići i pohrana preglednika",
        body: "Kolačić sesije prve strane služi prijavi do isteka sesije. OPULYA_LOCALE i OPULYA_THEME pamte jezik i izgled do jedne godine. Pohrana sesije preglednika pamti adresu e-pošte koja čeka potvrdu i rok ponovnog slanja; briše se nakon uspješne potvrde, brisanja računa ili odabira druge adrese. To su funkcije prijave i postavki, ne oglasno praćenje. Aplikacija trenutačno nema oglasne kolačiće, vanjsku analitiku posjetitelja ni marketinšku e-poštu. Hosting može zasebno obrađivati tehničke sigurnosne i dostavne zapise. Neobvezno praćenje prije uvođenja zahtijeva procjenu i, gdje je potrebno, privolu.",
      },
      rights: {
        title: "Vaša prava na privatnost",
        body: "Ovisno o pravu i obradi, možete zatražiti pristup, ispravak, brisanje, ograničenje ili prenosivost podataka te uložiti prigovor obradi na temelju legitimnih interesa. Privolu možete povući bez utjecaja na raniju zakonitu obradu. Postavke omogućuju ispravak imena, strojno čitljiv JSON izvoz, brisanje računa i ograničenje obrade. Ograničenje blokira financijske prikaze i promjene, ali čuva zapise; nužna autentifikacija i sigurnosna obrada se nastavljaju. Obradu možete izričito nastaviti u Postavkama. Za ispravak e-pošte, zapise kod pružatelja, prigovore ili druge zahtjeve kontaktirajte voditelja iznad; može biti potrebna razmjerna provjera identiteta. Ove kontrole ne ograničavaju vaša prava. Na zahtjeve se u pravilu odgovara u roku od mjesec dana, uz dopuštena produljenja. Možete se obratiti nadzornom tijelu, uključujući AZOP u Hrvatskoj.",
      },
      choices: {
        title: "Vaš izbor i automatizirana obrada",
        body: "Registracija zahtijeva ime, prezime i e-poštu; za prijavu su potrebni potvrđena adresa i lozinka. Sami birate koje financijske podatke unosite. Bez obveznih podataka ne možemo pružiti korisnički račun. Grafovi, budžeti i izračuni portfelja informativni su; Opulya ne donosi automatizirane odluke o kreditiranju, prihvatljivosti ili trgovanju za vas. Nema ugrađene prodaje osobnih podataka ni ciljanog oglašavanja.",
      },
      changes: {
        title: "Izmjene obavijesti",
        body: "Gornji datum označava posljednju izmjenu. Značajne promjene svrha, primatelja ili čuvanja zahtijevaju ažuriranu obavijest i odgovarajuću komunikaciju prije početka nove obrade. Kada je privola potrebna, sama izmjena ove stranice ne zamjenjuje njezino pribavljanje.",
      },
    },
  },
  security: {
    title: "Informacije o sigurnosti",
    intro:
      "Osobni financijski podaci zaslužuju pažljivu zaštitu. Ova stranica opisuje provedene kontrole i njihova ograničenja, a ne sigurnosni certifikat ni jamstvo da incident nije moguć.",
    sections: {
      controls: {
        title: "Uvedene zaštitne mjere",
        body: "Lozinke se sažimaju algoritmom Argon2id, ne pohranjuju se kao običan tekst. Pohranjuju se samo sažeci nasumičnih tokena sesije i potvrde. Autentifikacijski kolačići su HttpOnly i u produkciji koriste Secure; sesije istječu, a odjava ih opoziva. API provjerava vlasništvo, validira unos, ograničava zahtjeve i zlouporabu e-pošte te odbija izmjene iz nepouzdanih izvora. Financijske radnje koriste precizne decimalne izračune i transakcije baze. Konfiguracija aplikacije zahtijeva HTTPS u produkciji.",
      },
      access: {
        title: "Zaštita vašeg računa",
        body: "Koristite jedinstvenu lozinku ili zaporku, zaštitite pretinac koji prima potvrdne poveznice i odjavite se na zajedničkim uređajima. Ne dijelite lozinke, kolačiće sesije ni potvrdne poveznice. Opulya ne treba podatke za prijavu u banku, kod brokera ili na kriptoburzu. Nemojte ih unositi ni u jedno polje.",
      },
      limits: {
        title: "Važna ograničenja",
        body: "Podaci nisu šifrirani s kraja na kraj: ovlašteni voditelji usluge i pružatelji infrastrukture mogu tehnički pristupiti pohranjenim podacima. MFA, pristupni ključevi i samostalni oporavak lozinke nisu uvedeni. Sigurnost ovisi i o postavljanju, kontrolama pružatelja, pravodobnim nadogradnjama, upravljanju pristupom, sigurnosnim kopijama i odgovoru na incidente. Ne tvrdimo da je proveden neovisan penetracijski test ni dobiven OWASP certifikat. Opulya ne smije biti vaša jedina kopija važnih financijskih zapisa.",
      },
      reporting: {
        title: "Prijava sigurnosnog problema",
        body: "Kontaktirajte voditelja putem adrese za privatnost i sigurnost navedene u Obavijesti o privatnosti. Navedite stranicu, približno vrijeme i minimalne korake za ponavljanje, bez lozinki, tokena ili financijskih podataka drugih korisnika. Ne pristupajte tuđim računima i ne provodite ometajuća testiranja. Prijava ne odobrava testiranje hostinga ni drugih vanjskih usluga. Voditelj je odgovoran za istragu incidenata i obavijesti koje nalaže primjenjivi zakon.",
      },
    },
  },
  terms: {
    title: "Uvjeti korištenja",
    intro:
      "Ovi uvjeti opisuju namjeravano korištenje Opulye. Ne zamjenjuju Obavijest o privatnosti niti ograničavaju obvezna zakonska prava.",
    sections: {
      service: {
        title: "Alat za osobnu evidenciju",
        body: "Opulya omogućuje ručno praćenje računa, transakcija, budžeta i ulaganja. Nije banka, broker, skrbnik imovine ni financijski savjetnik. Ne čuva novac, ne izvršava plaćanja i ne trguje. Ništa prikazano nije preporuka za kupnju, prodaju ili držanje ulaganja.",
      },
      account: {
        title: "Odgovorno korištenje",
        body: "Koristite račun kojim smijete upravljati i čuvajte pristupne podatke. Ne unosite nezakonito pribavljene osobne podatke, ne zaobilazite kontrole pristupa, ne ometajte uslugu i ne koristite je nezakonito. Ne unosite lozinke banke ili brokera. Usluga je namijenjena odraslima; nema dječjih računa ni postupka roditeljske privole.",
      },
      records: {
        title: "Vaši zapisi",
        body: "Odgovorni ste za točnost unosa i provjeru izračuna prema izvodima banke ili brokera. Čuvajte neovisne kopije važnih zapisa. Uneseni podaci obrađuju se prema Obavijesti o privatnosti; ovi uvjeti ne prenose vlasništvo nad vašim osobnim zapisima na voditelja.",
      },
      prices: {
        title: "Tržišne informacije",
        body: "Cijene mogu kasniti, biti zastarjele, nedostupne ili netočne, a burzovne kotacije i valute treba pažljivo uskladiti. Vrijednosti portfelja i dobici ili gubici procjene su, a ne izvršive ponude za trgovanje ni porezni izvještaji. Za trgovanje i službene izvode koristite brokera. Pristup i daljnja distribucija vanjskih podataka podliježu uvjetima odgovarajućeg pružatelja.",
      },
      availability: {
        title: "Dostupnost i promjene",
        body: "Opulya može imati prekide, pogreške i promjene. Ne jamči se neprekidan rad ni točnost cijena. Značajne promjene usluge ili uvjeta treba odgovarajuće priopćiti. Ovo nije opće isključenje odgovornosti: obveze i pravna sredstva propisana primjenjivim zakonom ostaju na snazi.",
      },
      rights: {
        title: "Privatnost, pitanja i zakonska prava",
        body: "Za pitanja o usluzi i privatnosti, uključujući zatvaranje računa, obratite se voditelju iz Obavijesti o privatnosti. Ovi uvjeti ne ukidaju prava na privatnost, zaštitu potrošača, pritužbu regulatoru ni pravni lijek. Registracija ne zahtijeva opću privolu za marketing ili nepovezanu obradu podataka.",
      },
    },
  },
};
