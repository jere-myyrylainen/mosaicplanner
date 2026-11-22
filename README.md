# Mosaic Planner

Paikallinen selainohjelma mosaiikkikuvioiden suunnitteluun. Avaa `index.html` nykyaikaisessa selaimessa. Ohjelma toimii ilman asennusta, palvelinta tai verkkoyhteyttä.

Voit myös tarjoilla projektikansion paikallisesti. Käynnistä kansiossa `python3 -m http.server 8765 --bind 127.0.0.1` ja avaa selaimessa `http://127.0.0.1:8765`.

## Ensimmäinen työ

- Esimerkkityö Kompassiruusu avautuu ensimmäisellä käynnistyksellä. **Uusi** aloittaa tyhjän työn ja ottaa nykyisen palakirjaston mukaan.
- Valitse alustaksi suorakulmio, ympyrä tai pyöristetty suorakulmio. Alustan, apuristikon ja palojen mitat syötetään millimetreinä.
- Lisää **Apukuvat**-kohdasta JPG- tai PNG-kuvia ristikon ja mosaiikkipalojen alle. Säädä valitun kuvan leveyttä ja peittävyyttä tai valitse **Siirrä kuvaa** ja vedä työalueella. Apukuvat tallentuvat työn JSON-tiedostoon.
- Lisää palakirjastoon suorakulmion, ympyrän tai kolmion muotoisia paloja. Valitse palatyyppi ja aseta se napsauttamalla tai piirrä vetämällä. Viiva ja muoto asettavat paloja ääriviivalle. Täyttö asettaa paloja yhtenäiselle tyhjälle alueelle valitun palan mittojen mukaisessa ruudukossa.
- Säädä palakirjaston leveyttä vetämällä sen vasenta reunaa tai valitsemalla säädin sarkaimella ja käyttämällä nuolinäppäimiä. Leveys tallentuu selaimeen. Kaksoisnapsautus palauttaa oletusleveyden.
- Avaa palakirjastosta **Järjestä ja suodata**, kun haluat järjestää palat nimen mukaan tai suodattaa ne mittojen ja värin perusteella. Nimijärjestyksen valinta säilyy selaimessa.
- Värisuodatin käyttää väriryhmiä, kuten ruskeita ja keltaisia. Sama sävy voi kuulua useaan ryhmään.
- Lisää palatyypille pilkuilla erotetut tunnisteet, kuten `lasi, ulkokäyttö`. Tunnistepilvi näyttää, monellako palatyypillä tunniste on. Usean tunnisteen valinta näyttää palat, joilla on ne kaikki. Tunnisteet tallentuvat työn mukana.
- Sauman leveys määrää uusien palojen vähimmäisvälin. Jo asetetut palat säilyttävät sijaintinsa, kun sauman leveyttä muutetaan. Apuristikko on säädettävissä erikseen. Jos ristikkoon tarttuminen on käytössä, täyttö kohdistaa aloituspalan ristikkoon ja käyttää sitten palan mittoja ja saumaa seuraavien palojen asettamiseen.
- Poista palatyyppi palakirjaston roskakoripainikkeella. Työssä käytetyt palat säilyvät piirtoalueella ja tallennetussa tiedostossa.
- Valitse yksittäinen pala napsauttamalla. Rajaa useita paloja vetämällä tyhjästä kohdasta, tai lisää tai poista yksittäinen pala valinnasta Shift-napsautuksella. Vedä valittua palaa siirtääksesi koko valintaa. **Poista valitut** poistaa valinnan palat kerralla. Yksittäistä valittua palaa voi myös kiertää.
- Hiiren rulla suurentaa ja pienentää näkymää. Käsi-työkalulla tai välilyönti pohjassa vetäminen siirtää näkymää.
- Pyyhekumilla voit poistaa yhden palan napsauttamalla tai useita paloja vetämällä. Kumoa-painike palauttaa yhden vedon aikana poistetut palat kerralla.
- Avaa alalaidan **Palamäärät**, kun haluat tarkistaa työhön asetettujen palojen määrän palatyypeittäin. Myös kirjastosta poistetun palatyypin asetetut palat näkyvät määrissä.

Selain tallentaa viimeisimmän työn paikalliseen muistiin, jos selaimen asetukset sallivat sen. **Tallenna** lataa työn ja sen palakirjaston JSON-tiedostoksi. **Avaa** tuo sen takaisin editoriin, myös toisella laitteella.

## Pikanäppäimet

| Näppäin | Toiminto |
| --- | --- |
| V, B, L, M, G, H | Valinta, vapaa piirto, viiva, muoto, täyttö, näkymän siirto |
| E | Pyyhekumi |
| Esc | Palaa valintatyökaluun |
| Välilyönti + veto | Siirrä näkymää |
| R | Kierrä valittua palaa 15° |
| Shift + napsautus tai veto | Muokkaa nykyistä valintaa |
| Delete / Backspace | Poista valitut palat |
| Ctrl / ⌘ + Z | Kumoa |
| Ctrl / ⌘ + Shift + Z | Tee uudelleen |
| Ctrl / ⌘ + S | Tallenna tiedostoksi |
