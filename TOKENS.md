# Gasto de tokens — figma-mcp-lite (desenvolvimento)

Entrada nova = entrada sem cache + cache gravado. Cache lido custa ~10% do preço normal.

| quando (UTC) | tarefa | modelo | turnos | entrada nova | cache lido | saída | ferramentas (→enviado ←recebido) |
|---|---|---|---|---|---|---|---|
| 2026-10-26 13:56 | Chamar figma_status uma vez | sonnet-5-5 | 2 | 10.1k | 5.8k | 104 | figma_status×1 (→1 ←32) | <!-- a876965471ab00ac1 -->
| 2026-10-26 14:02 | Tela de login no Figma | sonnet-5-5 | 2 | 11.2k | 6.6k | 123 | figma_status×1 (→1 ←32) | <!-- a104eb2c86d061c1f -->
| 2026-10-26 14:12 | Tela de login no Figma | sonnet-5-5 | 3 | 11.4k | 17.9k | 344 | figma_status×2 (→1 ←65) | <!-- a60ed59975d0ead55 -->
| 2026-10-26 14:14 | Tela de login no Figma | sonnet-5-5 | 7 | 14.9k | 106.1k | 2.4k | figma_status×1 (→1 ←17), figma_ds×1 (→1 ←3.2k), figma_build×1 (→593 ←10), figma_shot×1 (→3 ←45), figma_run×2 (→68 ←30), 1 img | <!-- ab66fa7ab25fbd09d -->
| 2026-10-26 14:27 | Extrair docs do FCx Colors | sonnet-5-5 | 3 | 10.9k | 17.0k | 227 | figma_status×1 (→1 ←25), figma_ds×1 (→3 ←10) | <!-- a89174de34f686a3c -->
| 2026-10-26 14:32 | Extrair docs do FCx Colors | sonnet-5-5 | 3 | 7.3k | 20.8k | 262 | figma_status×1 (→1 ←25), figma_ds×1 (→3 ←33) | <!-- ac781261e955a5eee -->
| 2026-10-26 14:33 | Extrair docs do FCx Fonts | sonnet-5-5 | 2 | 7.2k | 10.0k | 278 | figma_status×1 (→1 ←32) | <!-- a22171aff552d348e -->
| 2026-10-26 14:34 | Extrair docs do FCx Fonts | sonnet-5-5 | 3 | 11.1k | 17.1k | 347 | figma_status×1 (→5 ←25), figma_ds×1 (→3 ←58) | <!-- a91b6679233e02390 -->
| 2026-10-26 15:02 | Login FCx modo remoto | sonnet-5-5 | 4 | 28.8k | 61.3k | 2.3k | figma_status×1 (→1 ←21), figma_ds×1 (→22 ←8.2k), figma_build×1 (→725 ←14), figma_shot×1 (→4 ←45), 1 img | <!-- a666eec2443c1dffe -->
| 2026-10-26 15:06 | Login FCx modo remoto | sonnet-5-5 | 10 | 36.0k | 219.0k | 9.9k | create_session×1 (→22 ←13), figma_ds×2 (→54 ←1.2k), use_figma×5 (→3.8k ←1.6k), figma_lite_install×1 (→1 ←2.3k), get_screenshot×1 (→30 ←124) | <!-- af7f66c8c065108a1 -->
| 2026-10-26 15:10 | Recuperar senha FCx remoto | sonnet-5-5 | 7 | 15.3k | 127.7k | 3.4k | create_session×1 (→25 ←13), figma_ds×2 (→62 ←2.7k), use_figma×3 (→847 ←21), get_screenshot×1 (→26 ←124) | <!-- a9b70eb2ac80d9d6a -->
| 2026-10-26 15:15 | Medição A: remoto, conector on | sonnet-5-5 | 7 | 33.2k | 142.3k | 8.4k | figma_status×1 (→1 ←32), figma_ds×1 (→37 ←2.4k), use_figma×3 (→3.7k ←24), figma_lite_install×1 (→1 ←2.4k), get_screenshot×1 (→13 ←124) | <!-- a83f40b425da60819 -->
| 2026-10-26 15:16 | Medição A2: remoto, conector on | sonnet-5-5 | 4 | 10.4k | 61.9k | 2.0k | figma_status×1 (→1 ←32), figma_ds×1 (→40 ←2.3k), use_figma×1 (→620 ←13), get_screenshot×1 (→13 ←124) | <!-- a236f4d435a539a9e -->
| 2026-10-26 15:19 | Medição A: remoto, conector on | sonnet-5-5 | 7 | 23.2k | 156.8k | 8.6k | figma_status×1 (→1 ←32), figma_ds×1 (→23 ←2.7k), use_figma×3 (→3.7k ←24), figma_lite_install×1 (→1 ←2.4k), get_screenshot×1 (→13 ←124) | <!-- a4176923468568cf3 -->
| 2026-10-26 15:20 | Medição A2: remoto, conector on | sonnet-5-5 | 4 | 10.2k | 61.5k | 2.0k | figma_status×1 (→1 ←32), figma_ds×1 (→42 ←2.2k), use_figma×1 (→654 ←13), get_screenshot×1 (→13 ←124) | <!-- af72bb836bc3eb25c -->
| 2026-10-26 15:22 | Medição B: plugin, conector on | sonnet-5-5 | 4 | 10.1k | 61.1k | 1.5k | figma_status×1 (→1 ←21), figma_ds×1 (→38 ←2.2k), figma_build×1 (→450 ←14), figma_shot×1 (→4 ←45), 1 img | <!-- ad9d5fab50fb3b221 -->
| 2026-10-26 15:25 | Medição C: plugin, conector off | sonnet-5-5 | 3 | 15.9k | 22.3k | 1.5k | figma_status×1 (→1 ←32), figma_ds×1 (→40 ←2.3k), figma_build×1 (→464 ←22) | <!-- a5500b068693cea51 -->
| 2026-10-26 15:27 | Medição C: plugin, conector off | sonnet-5-5 | 4 | 9.3k | 44.9k | 1.6k | figma_status×1 (→1 ←21), figma_ds×1 (→38 ←2.2k), figma_build×1 (→462 ←14), figma_shot×1 (→4 ←45), 1 img | <!-- afeee40631e0264ce -->
| 2026-10-26 15:33 | Medição D: Figma NATIVO (skills figma-use + generate-design, search_design_system), 1 tentativa | sonnet-5-5 | 8 | 98.3k | 569.5k | 6.4k | Skill×2, ToolSearch×1, create_session×1, search_design_system×1 (estourou, lido via Bash×2), use_figma×1 (→1.5k), get_screenshot×1 | <!-- a370cbe8eef09de3f -->
| 2026-10-26 16:23 | Medição E: 0.4.3 catálogo do Figma | sonnet-5-5 | 4 | 27.2k | 62.6k | 1.6k | figma_status×1 (→1 ←21), figma_ds×1 (→25 ←4.7k), figma_build×1 (→465 ←14), figma_shot×1 (→4 ←45), 1 img | <!-- a3a46abe03a88d751 -->
