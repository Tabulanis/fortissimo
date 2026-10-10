# env.sh — where the Android build tools live (10-09): all in the home folder, no root. `source tools/env.sh` before any gradle/cap command.
export JAVA_HOME="$(ls -d "$HOME"/.local/opt/jdk-21* | tail -1)"
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
