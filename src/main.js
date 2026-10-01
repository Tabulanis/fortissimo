import './audio/voices.js'
import * as THREE from 'three'

document.querySelector('#hud').textContent =
  'three r' + THREE.REVISION + ' · voices ' + (window.HB_VOICES ? 'ok' : 'MISSING')
