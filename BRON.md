# Broncode van de viewer in BIMpeil

Deze repo bevat de broncode van de viewer die [BIMpeil](https://bimpeil.nl) levert: [IfcLite](https://github.com/LTplus-AG/ifc-lite) van LTplus AG met de aanpassingen van BIMpeil. IfcLite en de aanpassingen vallen onder de Mozilla Public License 2.0 (zie LICENSE).

Elke versie die BIMpeil gebruikt, staat hier als één commit met een tag `viewer-<commit>`. Deze versie:

| | |
| --- | --- |
| Tag | `viewer-ceeacb5c3` |
| IfcLite | `@ifc-lite/renderer@6.0.1` (commit `e79f27342beb01a6f30d9b63c44795ecd118f4de`) |
| @ifc-lite/wasm | `10.3.0` |

De aanpassingen van BIMpeil staan in `apps/viewer/src/bimpeil/` en zijn in bestanden van IfcLite gemarkeerd met `BIMpeil:`; de lijst staat in `BIMPEIL.md`.

---

Source code of the viewer in BIMpeil: IfcLite by LTplus AG with BIMpeil's changes, under the Mozilla Public License 2.0. Each version used by BIMpeil is one commit tagged `viewer-<commit>`.
