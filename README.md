# Mosaic Planner

Paikallinen selainohjelma mosaiikkikuvioiden suunnitteluun. Avaa `index.html` nykyaikaisessa selaimessa. Ohjelma toimii ilman asennusta, palvelinta tai verkkoyhteyttä.

Voit myös tarjoilla projektikansion paikallisesti. Käynnistä kansiossa `python3 -m http.server 8765 --bind 127.0.0.1` ja avaa selaimessa `http://127.0.0.1:8765`.

## Ensimmäinen työ

- Esimerkkityö Kompassiruusu avautuu ensimmäisellä käynnistyksellä. **Uusi** aloittaa tyhjän työn ja ottaa nykyisen palakirjaston mukaan.
- Valitse alustaksi suorakulmio, ympyrä tai pyöristetty suorakulmio. Alustan, apuristikon ja palojen mitat syötetään millimetreinä.
- Lisää palakirjastoon suorakulmion, ympyrän tai kolmion muotoisia paloja. Valitse palatyyppi ja aseta se napsauttamalla tai piirrä vetämällä. Viiva ja muoto asettavat paloja ääriviivalle. Täyttö asettaa paloja yhtenäiselle tyhjälle alueelle valitun palan mittojen mukaisessa ruudukossa.
- Sauman leveys määrää uusien palojen vähimmäisvälin. Jo asetetut palat säilyttävät sijaintinsa, kun sauman leveyttä muutetaan. Apuristikko on säädettävissä erikseen. Jos ristikkoon tarttuminen on käytössä, täyttö kohdistaa aloituspalan ristikkoon ja käyttää sitten palan mittoja ja saumaa seuraavien palojen asettamiseen.
- Valintatyökalulla voit siirtää, kiertää ja poistaa yksittäisiä paloja. Hiiren rulla suurentaa ja pienentää näkymää. Käsi-työkalulla tai välilyönti pohjassa vetäminen siirtää näkymää.

Selain tallentaa viimeisimmän työn paikalliseen muistiin, jos selaimen asetukset sallivat sen. **Tallenna** lataa työn ja sen palakirjaston JSON-tiedostoksi. **Avaa** tuo sen takaisin editoriin, myös toisella laitteella.

## Pikanäppäimet

| Näppäin | Toiminto |
| --- | --- |
| V, B, L, M, G, H | Valinta, vapaa piirto, viiva, muoto, täyttö, näkymän siirto |
| Välilyönti + veto | Siirrä näkymää |
| R | Kierrä valittua palaa 15° |
| Delete / Backspace | Poista valittu pala |
| Ctrl / ⌘ + Z | Kumoa |
| Ctrl / ⌘ + Shift + Z | Tee uudelleen |
| Ctrl / ⌘ + S | Tallenna tiedostoksi |
