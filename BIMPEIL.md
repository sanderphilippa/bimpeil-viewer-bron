# bimpeil-viewer

Deze repo is een privé fork van [LTplus-AG/ifc-lite](https://github.com/LTplus-AG/ifc-lite) (MPL 2.0). De viewer (`apps/viewer`) draait in [BIMpeil](https://github.com/sanderphilippa/BIMpeil) op `/viewer/`. BIMpeil haalt deze repo op in `apps/viewer/.ifclite` en bouwt hem met `pnpm viewer:build`, op de commit die in `apps/viewer/ifclite.json` staat.

De volledige werkwijze (dagelijks werken, weigeringen van `viewer:build`, upgraden, problemen) staat in BIMpeil: [`docs/viewer.md`](https://github.com/sanderphilippa/BIMpeil/blob/main/docs/viewer.md). Dit bestand is de korte versie voor wie in de fork kijkt; bij verschil geldt `docs/viewer.md`.

## Branches en remotes

| | |
|---|---|
| `main` | Ongewijzigd ifc-lite; alleen bijwerken vanuit `upstream`. |
| `bimpeil` | Werkbranch met onze wijzigingen. |
| `origin` | `sanderphilippa/bimpeil-viewer` (privé) |
| `upstream` | `LTplus-AG/ifc-lite`, alleen ophalen (push staat uit) |

`main` staat op de release van `@ifc-lite/renderer@6.0.1` (`e79f273`). De gepubliceerde WASM hoort bij die commit, dus Rust is niet nodig.

## Werken aan de viewer

Vanuit BIMpeil: `pnpm dev:web` start de viewer met hot reload. Wijzig code in `apps/viewer/.ifclite`, commit op `bimpeil` en push naar `origin`. Zet daarna in BIMpeil de nieuwe commit vast met `pnpm viewer:pin` en commit `ifclite.json`.

Houd wijzigingen in bestanden van ifc-lite klein: elke wijziging moet bij elke upgrade opnieuw passen. Nieuwe code hoort in `apps/viewer/src/bimpeil/`.

## Upgraden

Alleen per major, na review van de changelog, en alleen naar een commit waarvoor `@ifc-lite/wasm` op npm staat:

```sh
git fetch upstream
git checkout main && git merge --ff-only <release commit>
git push origin main
git checkout bimpeil && git merge main     # geen rebase, dan is een force push nooit nodig
git push origin bimpeil
```

Daarna in BIMpeil: `pnpm viewer:build`, de testset draaien, `pnpm viewer:pin`, caches opnieuw opbouwen.

## Wijzigingen ten opzichte van ifc-lite

De geschiedenis staat op `bimpeil` (`git log main..bimpeil`). De eerste 16 commits heten `bimpeil: 00NN-<naam>.patch`; tot 7 oktober 2026 bewaarde BIMpeil ze als patchbestanden.

Nieuwe bestanden: `apps/viewer/src/bimpeil/` en de logo's in `apps/viewer/public/bimpeil-logo*.svg`.

Gewijzigde bestanden van ifc-lite (onder `apps/viewer/src/`):

- `App.tsx`
- `main.tsx` (import van `src/bimpeil/fonts.ts`: Material Symbols meegeleverd)
- `components/viewer/KeyboardShortcutsDialog.tsx`, `KeyboardShortcutsDialogTabs.tsx`
- `components/viewer/MobileToolbar.tsx`, `ViewerLayout.tsx`, `ViewportContainer.tsx`, `ViewportWelcomeCard.tsx`
- `components/viewer/change-sets/ChangeSetPanel.tsx`
- `components/viewer/dock/FloatingPanel.tsx`
- `components/viewer/ribbon/RibbonToolbar.tsx`, `ribbon/tabs/FileTab.tsx`
- `components/viewer/toolbar/useFileCommands.tsx`
- `components/viewer/IDSPanel.tsx`, `IDSPanelStates.tsx`, `validation/ValidationPanel.empty.tsx` (IDS alleen uit BIMpeil, `src/bimpeil/BimpeilIdsSource.tsx`, vlag en controle in `src/bimpeil/idsOnly.ts`)
- `components/viewer/flow/automation/CheckJobsEditor.tsx`, `lib/flow/check-resources.ts`, en in de test `lib/flow/session-workflow.test.ts` (in Flow een IDS alleen uit BIMpeil)
- `components/viewer/HierarchyPanel.tsx` en in `components/viewer/hierarchy/`: `types.ts`, `revealGlobalId.ts`, `useHierarchyTree.ts`, `rowSelection.ts`, `useHierarchyTreeKeyboard.ts`, `HierarchyNode.tsx` (indeling per hoofdstuk van de BIM basis ILS, de boom zelf in `src/bimpeil/ilsTree.ts`)
- `hooks/useLens.ts` (de lens van de classificatieregels: niet bewaard, treffers al uitgerekend in `src/bimpeil/classRulesStore.ts`); de boom per klas (`klassen`) gebruikt dezelfde haken als de ILS indeling hierboven
- `hooks/useKeyboardShortcuts.ts`, `hooks/usePanelControls.ts`
- `hooks/useRailPanelIds.ts`, `components/viewer/ribbon/PanelGroupBrowser.tsx`, `components/viewer/surface-commands-panels.ts` (panelen die BIMpeil niet aanbiedt, nu Bronnen: `src/bimpeil/hiddenPanels.ts`, met daar hoe je het terugdraait), en in de tests `surface-commands-panels.test.ts` en `toolbar/cloud-sources-entrypoints.test.tsx`
- `i18n/en.ts`
- `lib/panels/registry.ts`, `lib/panels/renderPanelBody.tsx`
- `store/index.ts`, `store/slices/uiSlice.ts`, `store/slices/uiPreferences.ts`, `store/store-sync.ts`

Buiten `src/`: `apps/viewer/index.html` (geen Google Fonts meer) en `apps/viewer/package.json` met `pnpm-lock.yaml` (`material-symbols`, Apache 2.0).

Nieuwe pagina naast de viewer: `apps/viewer/bimpeil-checker.html` met `src/bimpeil/checker/` (controle met een IDS zonder viewer, voor de pagina Controles van BIMpeil; als invoer toegevoegd in de Vite configuratie van BIMpeil, niet in die van ifc-lite).

Aanpassingen in bestanden van ifc-lite zijn sinds 7 oktober 2026 gemarkeerd met `BIMpeil:`. Overzicht met `git diff --name-status main bimpeil`.

## Licentie

ifc-lite valt onder MPL 2.0. Gewijzigde ifc-lite bestanden blijven MPL 2.0. Wordt de viewer aan derden geleverd (BIMpeil voor externe gebruikers), dan moet de broncode van de MPL bestanden voor hen beschikbaar zijn. Dat gebeurt sinds 17 oktober 2026 via de openbare repo `sanderphilippa/bimpeil-viewer-bron`: per vastgezette commit de broncode als één commit met een tag `viewer-<commit>` (`pnpm viewer:publiceer` in BIMpeil). Deze fork blijft privé. Het Info venster van de viewer linkt naar die tag (`src/bimpeil/SourceLink.tsx`).
