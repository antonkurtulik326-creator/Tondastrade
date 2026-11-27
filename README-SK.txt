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


MULTI-TIMEFRAME TRADING SYSTEM (v3)
- Preferovaný plán: 4H určuje smer, 1H vytvára setup, 15M potvrdzuje vstup.
- Porovnávajú sa tri varianty: samostatný 1H, 1H s filtrom 4H a kombinácia 4H+1H+15M.
- Všetky tri varianty vychádzajú z jedného radu 15M sviečok; 1H a 4H sa agregujú z rovnakých dát, aby obdobie bolo porovnateľné.
- Binance načítava až 4 000 15M sviečok stránkovaním. Twelve Data môže mať podľa plánu menej histórie a test sa nemusí dať spustiť.
- Používa sa 1H ATR pre SL, cieľ 2R, rovnaké spread/poplatky a 70/30 časové rozdelenie. Swap/financovanie CFD nie je započítané.
- MTF agregácia je určená najmä pre 24/7 krypto trhy. Pri akciách/ETF treba rešpektovať obchodné seansy.
- Pri menej ako 100 obchodoch sú štatistiky len orientačné. Výsledky nie sú zárukou budúcich ziskov.

NOVÉ ROZHRANIE (v4)
- Aplikácia je rozdelená do štyroch samostatných pracovných sekcií: Prehľad, MTF stratégia, Backtest a Nastavenia.
- Watchlist, vyhľadávanie symbolov, výber timeframe a stav dát zostávajú hore dostupné vo všetkých sekciách.
- Prehľad obsahuje signál, výpočet pozície/rizika a cenový graf.
- MTF stratégia obsahuje 4H → 1H → 15M rozhodovací proces a porovnanie variantov.
- Backtest obsahuje historické metriky, equity krivku, posledné obchody a vysvetlenie signálu.
- Nastavenia obsahujú dátový zdroj, upozornenia a import vlastných CSV dát.
- Aktívna sekcia sa pamätá v tomto prehliadači. Pri aktualizácii treba nahrať celý obsah ZIP do koreňového priečinka GitHub Pages.


VERZIA v6 – OBCHODNÝ PLÁN A DENNÍK
- MTF panel po analýze zobrazí LONG/SHORT plán s ENTRY, SL a TP1–TP3.
- Časový odhad k cieľom vychádza z 1H ATR; je orientačný, nie garancia.
- Horizont plánu je 24 hodín. Aplikácia sama príkazy nezadáva ani nezatvára.
- Nová sekcia Obchodný denník umožňuje uložiť signál, označiť využitie v XTB a manuálne zaznamenať TP/SL/uzavretie/expiráciu.
- Denník je lokálny v prehliadači a možno ho exportovať do CSV.
- Aplikácia nemá prístup k reálnym pozíciám XTB. Výsledky musí používateľ označiť podľa účtu.
- Pravdepodobnosti TP/SL sa nezobrazujú, kým nie sú spoľahlivo kalibrované na historických dátach.
