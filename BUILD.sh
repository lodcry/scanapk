#!/bin/bash
set -e
cd "$(dirname "$0")/scan3d-react/packages/client"

echo "📦 Instalando dependências do React (scan3d-react)..."
npm install

echo ""
echo "🔨 Buildando pra dentro de app/src/main/assets/..."
npx vite build

echo ""
echo "✅ Build concluído. Conteúdo de assets/:"
ls -la ../../../app/src/main/assets/

echo ""
echo "Próximo passo: compilar o APK (precisa de Android SDK/NDK —"
echo "não roda no Termux). Suba este diretório pro GitHub e use"
echo "Codemagic, ou abra no Android Studio."
