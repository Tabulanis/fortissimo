# Fortissimo — store listing (draft, 2026-10-09)

Everything a store page asks for, in one place. Lines marked **[OWNER]** need his words or art.

## The name — checked 2026-10-09
A web search for "Fortissimo" games found: *Fortissimo Kids* (a children's music-learning app, iOS/Android), *Fortissimo Music House*
(a music-education VR title on the Meta store), and *Le Concert ff (Fortissimo)* (a 2010 Japanese PlayStation rhythm game, not on any
current store). None is a rhythm game on Google Play or Steam today, but "Fortissimo" alone is crowded in the music-app space.
**[OWNER]** decide: ship as "Fortissimo", or give it a second word that makes it findable and distinct (e.g. "Fortissimo: Siege",
"Fortissimo — Drums of the Town"). A trademark search (USPTO TESS, free) before the store page goes up is the professional step;
this web search is not that.

## Short description (80 chars max on Play)
Drum the town's defence. The rhythm game where you are the instrument.

## Full description  **[OWNER: your voice]**
You stand at the kit in a Roman garden under siege. Every drum you hit raises the shield; every mortar you fire on the beat knocks
an arrow out of the sky. Play the drums, the guns and the lightning crystals through three movements — then the sea gate rises,
and the Hydra comes.

- Play with the keyboard, a touchscreen, or a game controller
- Five difficulty levels and a full set of modifiers
- Make your own songs with the built-in song maker
- Timing calibration so it feels right on any device
- No ads, no accounts, nothing collected

## Category / tags
Music · Rhythm · Arcade. Tags: rhythm, drums, music game, controller support, offline.

## Age rating (IARC questionnaire — the honest answers)
Fantasy violence: cartoon creatures (minotaurs, a hydra), no blood, no gore, no realistic violence. No language, no sex, no drugs,
no gambling, no user interaction, no purchases, no ads, no location, no data collection. Expected: PEGI 7 / ESRB E10+ or E.

## Privacy policy
`public/legal/privacy.html` — ships inside the game; also host it at a public URL for the store form (GitHub Pages works).
**[OWNER]** confirm the contact email on it.

## Assets checklist
| Asset | Size | Status |
|---|---|---|
| App icon | 512×512 PNG | placeholder (gold drum) — **[OWNER art]** `public/app/icon-512.png`, then `npx capacitor-assets generate --android` |
| Feature graphic (Play) | 1024×500 | placeholder `store/feature-graphic.png` — **[OWNER art]** |
| Screenshots | 1920×1080, 2–8 | `store/shots/` (drums, bass, treble, sea) — re-run `tools/store-shots.sh` after look changes; add the Hydra |
| Trailer | 30 s, landscape | not made — **[OWNER]** screen-record a round on Void, or we script a camera fly-through |
| Store icon (Steam) | 1024×1024 + capsules | later, with the Steam page |

## Accounts (one-time, his card, his logins — nothing here can create them)
- Google Play Console developer account (one-time fee). Then: create the app → Internal testing → upload the .aab from `out/<version>/`.
- Later: Apple Developer (yearly), needs a Mac to sign. Steam Direct (one-time fee per game).

## Studio details  **[OWNER]**
- Studio / developer name as it will show on the store: "Tabulanis" or a studio name
- Contact email, and a one-page website for the store to link (GitHub Pages is enough)
