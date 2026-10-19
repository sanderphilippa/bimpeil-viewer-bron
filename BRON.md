# Broncode van de viewer in BIMpeil

Deze repo bevat de broncode van de viewer die [BIMpeil](https://bimpeil.nl) levert: [IfcLite](https://github.com/LTplus-AG/ifc-lite) van LTplus AG met de aanpassingen van BIMpeil. IfcLite en de aanpassingen vallen onder de Mozilla Public License 2.0 (zie LICENSE).

Elke versie die BIMpeil gebruikt, staat hier als één commit met een tag `viewer-<commit>`. Deze versie:

| | |
| --- | --- |
| Tag | `viewer-61b5c3709` |
| IfcLite | `@ifc-lite/wasm@10.4.0` (commit `a8905535c861ca42e69f33ee8be138dea5c828b2`) |
| @ifc-lite/wasm | `10.4.0` |

De aanpassingen van BIMpeil staan in `apps/viewer/src/bimpeil/` en zijn in bestanden van IfcLite gemarkeerd met `BIMpeil:`; de lijst staat in `BIMPEIL.md`.

De map `.github` van IfcLite (hun workflows en Dependabot) staat hier niet in: die hoort bij hun eigen ontwikkeling, niet bij de broncode van de viewer. Bijdragen en issues horen bij [IfcLite](https://github.com/LTplus-AG/ifc-lite); deze repo neemt geen pull requests aan.

---

Source code of the viewer in BIMpeil: IfcLite by LTplus AG with BIMpeil's changes, under the Mozilla Public License 2.0. Each version used by BIMpeil is one commit tagged `viewer-<commit>`.
