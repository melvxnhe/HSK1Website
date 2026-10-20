# HSK 1 Chinesisch

Lernseite für die HSK-1-Vokabeln (~150 Wörter): Pinyin, Aussprache, Karteikarten mit Wiederholungsplan,
Quiz, Schreibübungen und Statistik. Oberfläche und Bedeutungen auf Deutsch oder Englisch.
Nur HTML/CSS/JavaScript, du musst nichts installieren.

## Starten

**Doppelklick auf `start.bat`**: Das startet den Server auf <http://localhost:8000> und öffnet den Browser.
Zum Beenden das Fenster schließen oder `Strg+C` drücken.

Oder im Terminal (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1                 # http://localhost:8000
powershell -ExecutionPolicy Bypass -File .\serve.ps1 -Port 8080 -Open
```

## Wo wird mein Fortschritt gespeichert?

Bei jeder Antwort wird automatisch an zwei Orten gespeichert:

1. **Im Browser** (localStorage), sofort.
2. **Auf der Festplatte** in `data/progress.json`, über den Server (`serve.ps1`). Das bleibt auch erhalten, wenn du
   den Browserverlauf löschst oder einen anderen Browser benutzt.

Zusätzlich legt der Server jeden Tag eine Sicherung in `data/backups/` an (die letzten 14 Tage werden behalten).
In **Einstellungen → Exportieren** bekommst du außerdem eine eigene Sicherungsdatei, die du wieder importieren kannst.

Oben rechts zeigt die Seite den Speicherstatus an:
- **✓ Gespeichert**: Browser und Festplatte sind aktuell.
- **⚠ Nur im Browser**: Der Server läuft nicht (z. B. wenn `index.html` direkt geöffnet wurde). Starte die Seite
  über `start.bat`, dann wird automatisch nachgespeichert.

## Funktionen

- **Lernen: Tägliche Wiederholung.** Karteikarten mit Wiederholungsplan (Spaced Repetition, wie bei Anki). Du bewertest jede
  Karte mit Nochmal / Schwer / Gut / Einfach, und jedes Wort kommt genau dann wieder, wenn du es sonst vergessen würdest.
  Die Zahl neuer Wörter pro Tag ist einstellbar.
- **Lernen: Freies Üben.** Beliebige Auswahl üben: eine Lektion, „Noch nicht gelernt“, „Schwierige Wörter“, die Fehler aus dem letzten Quiz …
- **Richtungen.** Zeichen → Bedeutung, Bedeutung → Zeichen, Hören → Bedeutung.
- **Quiz mit 6 Modi.** Zeichen → Bedeutung, Bedeutung → Zeichen, Zeichen → Pinyin, Hören → Zeichen, Töne erkennen,
  Pinyin tippen (z. B. `ni3 hao3`). Danach kannst du deine Fehler gezielt üben.
- **Schreiben.** Strichfolge als Animation und selbst nachzeichnen (mit Maus, Finger oder Stift), auch aus dem Gedächtnis.
  Braucht beim ersten Laden eines Zeichens Internet (Bibliothek Hanzi Writer).
- **Statistik.** Tage in Folge, Trefferquote, Aktivität der letzten 14 Tage, fällige Wiederholungen, Fortschritt pro
  Lektion, schwierigste Wörter.
- **Einstellungen.** Sprache, hell/dunkel, Stimme und Sprechtempo, Tagesziel, neue Wörter pro Tag, Export/Import.
- **Tastatur.** Leertaste = umdrehen, 1–4 = bewerten/antworten, S = anhören, Enter = weiter.

## Aussprache (Audio)

Die Aussprache kommt aus der Sprachausgabe des Browsers und braucht eine chinesische Stimme:

- **Microsoft Edge** hat meist schon chinesische Stimmen eingebaut. Das ist am einfachsten.
- **Chrome / Windows:** *Einstellungen → Zeit und Sprache → Sprache & Region → Sprache hinzufügen → Chinesisch (vereinfacht)*
  mit Sprachausgabe installieren. Danach den Browser neu starten.

In den Einstellungen der Seite kannst du die Stimme auswählen und testen.

## Projektstruktur

```
index.html          Seitenrahmen + Navigation
css/style.css       Design (hell & dunkel)
js/data.js          HSK-1-Wörter, Lektionen, Beispielsätze (DE + EN)  ← hier Inhalte ergänzen
js/i18n.js          Texte der Oberfläche (DE + EN)
js/store.js         Fortschritt, Wiederholungsplan, Speichern (Browser + Festplatte)
js/app.js           Seiten: Start, Lernen, Pinyin, Lektionen, Vokabeln, Quiz, Schreiben, Statistik, Einstellungen
serve.ps1           lokaler Webserver + Speicher-API (/api/progress)
start.bat           Starter zum Doppelklicken
data/               dein gespeicherter Fortschritt + tägliche Sicherungen
```
