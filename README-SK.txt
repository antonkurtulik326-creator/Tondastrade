TRADE RADAR – WEBOVÁ VERZIA
============================

ČO JE V BALÍKU
- index.html: aplikácia (HTML, CSS a JavaScript v jednom súbore)
- manifest.webmanifest, sw.js: PWA nastavenia a cache pre inštaláciu do mobilu
- icon-192.png, icon-512.png, icon-maskable-512.png: ikony

DÔLEŽITÉ K WEBNODE A CENE
Webnode povoľuje vloženie vlastného HTML kódu len v platenom Premium balíku
(pre projekty vytvorené po 26. 6. 2023). Preto túto aplikáciu nedáva zmysel
vkladať priamo do bezplatného Webnode.

Bezplatné riešenie:
1. Nahraj celý obsah priečinka trade-radar-web do GitHub repozitára.
2. V repozitári otvor Settings → Pages.
3. V časti Build and deployment zvoľ Deploy from a branch.
4. Vyber branch main a folder /(root), potom Save.
5. Po publikovaní dostaneš adresu v tvare https://POUZIVATEL.github.io/NAZOV-REPOZITARA/
6. Na bezplatnej Webnode stránke môžeš vytvoriť obyčajný odkaz/tlačidlo „Otvoriť Trade Radar“
   smerujúce na túto adresu. Vloženie aplikácie priamo do stránky cez HTML/iframe by vyžadovalo
   Webnode Premium.

Alternatíva: Cloudflare Pages vie tiež hostovať statický web. Netreba Python server.

TRHOVÉ DÁTA
- Binance: verejné kryptomenové dáta bez API kľúča.
- Twelve Data: akcie, ETF, forex a podporované krypto páry; treba vlastný API kľúč.
  Kľúč sa v tejto verzii ukladá do localStorage prehliadača. Nepoužívaj ho na zdieľanom
  zariadení a maj na pamäti, že ho možno vidieť v sieťových požiadavkách prehliadača.
- Yahoo Finance backend je v tejto statickej verzii vypnutý, pretože GitHub Pages/Webnode
  nespúšťajú Python server.

TIMEFRAME
- 15 minút, 1 hodina, 4 hodiny.
- Binance používa natívne intervaly 15m, 1h a 4h.
- Twelve Data používa 15min, 1h a 4h; dostupnosť závisí od symbolu a plánu poskytovateľa.

HYBRIDNÉ VYHODNOTENIE
Aplikácia kombinuje technické skóre s automatickým textovým kontextom z EMA, RSI, ADX,
vyššieho timeframe a objemu. Toto nie je generatívny AI model. Skutočná LLM analýza by
vyžadovala samostatný server/serverless endpoint a API kľúč uložený bezpečne na serveri.
API kľúč AI nikdy nevkladaj priamo do index.html.

OBMEDZENIA
- Automatická aktualizácia a upozornenia fungujú len vtedy, keď je stránka otvorená
  a prehliadač ju aktívne neuspí.
- Po úplnom zavretí stránky sa trh ďalej nekontroluje.
- Bezplatné API majú limity, oneskorenia a rozdielne pokrytie symbolov.
- CFD výpočty sú orientačné; aplikácia neposiela objednávky na burzu.
- Signály a backtest nie sú investičné odporúčanie ani záruka výsledku.

PRVÉ SPUSTENIE
1. Otvor webovú adresu aplikácie.
2. V sekcii Dátový zdroj vyber Binance pre krypto.
3. Pre akcie/ETF/forex vyber Twelve Data a vlož vlastný API kľúč.
4. Pridaj symboly do watchlistu a nastav účet/riziko.
5. V Chrome na Androide môžeš použiť menu ⋮ → Pridať na plochu / Inštalovať aplikáciu.

Poznámka: Po nasadení skontroluj, že GitHub Pages publikuje všetky súbory v koreňovom priečinku.
