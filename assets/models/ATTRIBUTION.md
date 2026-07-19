# Anatomy Model Attribution

These assets are for educational visualization. They are not medical advice and do not imply endorsement by NIH, HuBMAP, the Human Reference Atlas team, or the original creators.

## Heart and Torso

The packaged `heart.glb` and `torso.glb` are adaptations of the Human Reference Atlas united male reference-organ set:

> Browne, Kristen, and Heidi Schlehlein. 2026. *3D Reference Organ Set for Male, v1.10*. https://doi.org/10.48539/HBM833.WZWN.425.

- Source record: https://cdn.humanatlas.io/hra-kg--staging/ref-organ/united-male/v1.10
- Source file: `3d-vh-m-united.glb`
- Source SHA-256: `fae3ac193835e9e24cd13a0d0f11e6788183b290b0691b9b83ec81d907d94581`
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- License text: https://creativecommons.org/licenses/by/4.0/

Adaptations made for this course app: exam-relevant anatomical subtrees were extracted, geometry was simplified and quantized for mobile delivery, and mesh names were preserved for structure selection. The rendered heart and torso poster images are derivatives of the same source and use the same license.

## Brain

The packaged `brain.glb` is the official NIH 3D input GLB for HRA Brain, Male v1.3 and is included without geometry changes:

> Kristen Browne; Heidi Schlehlein. 2023. *3D Reference Organ for Brain, Male v1.3*. https://doi.org/10.48539/HBM929.XKCL.339. Accessed on December 15, 2023.

- NIH 3D record: https://3d.nih.gov/entries/20960?version=1
- HRA reference: https://purl.humanatlas.io/ref-organ/brain-male/v1.3
- Source file: `3d-vh-m-allen-brain.glb`
- NIH 3D file ID: `607449`
- Packaged/source SHA-256: `2b9ad5b53e40e9f0936da74f7be38d2eed15604e26358c3870a0ea13499b9a35`
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- License text: https://creativecommons.org/licenses/by/4.0/

The rendered brain poster is a derivative of this model and uses the same license.

## Optimization Tool

`tools/gltfpack` is from meshoptimizer v1.2 by Arseny Kapoulkine and is distributed under the MIT License. See `tools/MESHOPTIMIZER-LICENSE.md`.
