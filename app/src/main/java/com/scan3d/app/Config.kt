package com.scan3d.app

object Config {
    // Sem defaults hardcoded — o app detecta se é primeira abertura
    // e mostra tela de setup pedindo as 2 URLs antes de qualquer coisa.
    // Isso evita o problema de "URL errada por padrão" e força o usuário
    // a configurar conscientemente antes de usar.
    const val PREFS_KEY_CONFIGURED = "genesis_configured"
}
