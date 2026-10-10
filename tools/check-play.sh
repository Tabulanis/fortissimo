#!/bin/bash
# check-play.sh — THE PRE-RELEASE ROBOT (10-09): a robot plays round 1 right through on each graphics level and the results
# panel must appear. Prints one line per level: PASS/FAIL + the results text. Needs the dev server (:5180) and the sink (:8899).
#   tools/check-play.sh            low medium high
#   tools/check-play.sh medium     one level
S=/tmp/fortissimo-dev "$(dirname "$0")/.."; fail=0
for q in ${@:-low medium high}; do
  n0=$(grep -c "/info_full\|/err_full" $S/create.log 2>/dev/null || echo 0)
  mkdir -p $S/ffcp && cp $S/ffp/user.js $S/ffcp/
  timeout 400 ~/.local/opt/firefox/firefox --headless --no-remote --window-size 1100,760 --profile $S/ffcp "http://127.0.0.1:5180/tests/harness/_fullplay.html#q=$q" >/dev/null 2>&1
  for p in $(ls /proc | grep -E '^[0-9]+$'); do ls -l /proc/$p/fd 2>/dev/null | grep -q "$S/ffcp/" && kill $p; done; sleep 1; rm -rf $S/ffcp
  line=$(grep "/info_full\|/err_full" $S/create.log | tail -1)
  n1=$(grep -c "/info_full\|/err_full" $S/create.log 2>/dev/null || echo 0)
  if [ "$n1" -gt "$n0" ] && echo "$line" | grep -q "RESULTS:"; then echo "PASS $q: $(echo "$line" | grep -o 'RESULTS:.*' | cut -c1-160)"; else fail=1; echo "FAIL $q: $(echo "$line" | tail -c 200)"; fi
done
exit $fail
