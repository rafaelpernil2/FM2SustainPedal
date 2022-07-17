let midiAccess = null;
let midiInputSelected = null;
let midiOutputSelected = null;
let inputMidiChannel = null;
let outputMidiChannel = null;
let input = null;
let output = null;
let isSustainOn = false;
let isLatchSustainOn = false;
let sustainedNoteList = new Set();
const SUSTAIN_PEDAL = 64;
const VOLCA_FM_NAME_MATCH = "volca";
const CC_MSG = 0xb;
const NOTE_ON_MSG = 0x9;
const NOTE_OFF_MSG = 0x8;
const ANY_DEVICE = "--- Any device ---";
const RECOMMENDED = " (Recommended)";
const ANY_DEVICE_VALUE = "anyDevice";
const NO_DEVICE = "--- No device ---";
const NO_DEVICE_VALUE = "noDevice"
const ANY_CHANNEL = "Any";
const ANY_CHANNEL_VALUE = -1;
const SUSTAIN_LATCH_TOGGLE_OFF = "Off";
const SUSTAIN_LATCH_TOGGLE_OFF_VALUE = false;
const SUSTAIN_LATCH_TOGGLE_ON = "On";
const SUSTAIN_LATCH_TOGGLE_ON_VALUE = true;


/** MAIN */
(async () => {
  // Connect MIDI
  try {
    midiAccess = await navigator.requestMIDIAccess();
    onMIDISuccess(midiAccess);
  } catch (error) {
    onMIDIFailure();
  }

  // Initialize DOM components
  initInputSelector(midiAccess);
  initInputChannelSelector();
  initOutputChannelSelector();
  initOutputSelector(midiAccess);
  initLatchSustainSelector();
})();


function onMIDISuccess() {
  console.log("MIDI ready!");
}

function onMIDIFailure(msg) {
  console.log("Failed to get MIDI access - " + msg);
  alert(
    "Ooops! Your browser does not support WebMIDI. \nPlease use Google Chrome or a Chromium based browser (like Edge)."
  );
  window.location.href = "about:blank";
}

/**
 * SETUP FUNTIONS
 */
function initInputSelector(midiAccess) {
  // Selector
  const selector = document.getElementById("InputSelector");

  // Event listener
  selector.addEventListener("change", () => {
    if (midiInputSelected === ANY_DEVICE_VALUE) {
      [...midiAccess.inputs].forEach(([, device]) => device.onmidimessage = null);
    } else if (input != null) {
      input.onmidimessage = null;
    }

    [midiInputSelected, input] = [selector.value, midiAccess.inputs.get(selector.value)];
    forwardMIDIEvents(midiAccess);
  });

  // Options
  addOptions(selector, ANY_DEVICE, ANY_DEVICE_VALUE);
  for (const [id, midiInput] of midiAccess.inputs) {
    addOptions(selector, midiInput.name, id);
  }
}


function initOutputSelector(midiAccess) {
  // Selector
  const selector = document.getElementById("OutputSelector");

  // Event listener
  selector.addEventListener("change", () => [midiOutputSelected, output] = [selector.value, midiAccess.outputs.get(selector.value)]);

  // Options
  for (const [id, midiOutput] of midiAccess.outputs) {
    addOptions(selector, midiOutput.name, id);
  }
}

function initInputChannelSelector() {
  // Selector
  const selector = document.getElementById("InputChannelSelector");

  // Event listener
  selector.addEventListener("change", () => inputMidiChannel = Number(selector.value));

  // Options
  addOptions(selector, ANY_CHANNEL, ANY_CHANNEL_VALUE);
  for (let index = 0; index < 16; index++) {
    addOptions(selector, String(index + 1), index);
  }
}

function initOutputChannelSelector() {
  // Selector
  const selector = document.getElementById("OutputChannelSelector");

  // Event listener
  selector.addEventListener("change", () => outputMidiChannel = Number(selector.value));

  // Options
  for (let index = 0; index < 16; index++) {
    addOptions(selector, String(index + 1), index);
  }
}

function initLatchSustainSelector() {
  // Selector
  const selector = document.getElementById("LatchSustainSelector");

  // Event listener
  selector.addEventListener("change", () => {
    isLatchSustainOn = selector.value === "true";
    isSustainOn = isLatchSustainOn;

    // If the latch is off, release all sustained notes
    if (!isLatchSustainOn) {
      onSustainPedalChange(0);
    }
  });

  // Options
  addOptions(selector, SUSTAIN_LATCH_TOGGLE_OFF + RECOMMENDED, SUSTAIN_LATCH_TOGGLE_OFF_VALUE);
  addOptions(selector, SUSTAIN_LATCH_TOGGLE_ON, SUSTAIN_LATCH_TOGGLE_ON_VALUE);
  selector.value = SUSTAIN_LATCH_TOGGLE_OFF_VALUE;
  isLatchSustainOn = SUSTAIN_LATCH_TOGGLE_OFF_VALUE;
  isSustainOn = SUSTAIN_LATCH_TOGGLE_OFF_VALUE;
}


/**
 * MIDI HANDLERS
 */
function onMIDIMessage() {
  return (event) => {
    const [headerChunk, noteCC, velocityValue] = [...event.data];
    const [header, channel] = splitMIDIHeader(headerChunk);

    // Filter by midi channel
    if (inputMidiChannel !== ANY_CHANNEL_VALUE && channel !== inputMidiChannel)
      return;

    switch (header) {
      case NOTE_ON_MSG:
        onNoteOn(noteCC, velocityValue);
        break;
      case NOTE_OFF_MSG:
        onNoteOff(noteCC);
        break;
      case CC_MSG:
        onCCMessage(noteCC, velocityValue);
        break;
      default:
        onDefaultMIDIMessage(header, noteCC, velocityValue)
        break;
    }
  };
}

function forwardMIDIEvents(midiAccess) {
  if (input == null) return;

  if (midiInputSelected === ANY_DEVICE_VALUE) {
    [...midiAccess.inputs].forEach(([, device]) => device.onmidimessage = onMIDIMessage());
  } else {
    input.onmidimessage = onMIDIMessage();
  }
}

/** Custom functions for Volca FM2 */


function onDefaultMIDIMessage(header, noteCC, velocityValue) {
  output.send([buildMIDIHeader(header, outputMidiChannel), noteCC, velocityValue]);
}


function onNoteOn(note, velocity) {
  // Remove from notes to be sustained
  sustainedNoteList.delete(note);

  // Generic note message to trigger the output
  output.send([buildMIDIHeader(NOTE_ON_MSG, outputMidiChannel), note, velocity]);
}


function onNoteOff(note) {
  // If sustain is on, do not release notes
  if (isSustainOn) {
    sustainedNoteList.add(note);
    return;
  };

  output.send([buildMIDIHeader(NOTE_OFF_MSG, outputMidiChannel), note, 64])
}

function onCCMessage(cc, value) {
  if (cc === SUSTAIN_PEDAL) {
    onSustainPedalChange(value);
    return;
  }
  onDefaultMIDIMessage(CC_MSG, cc, value)
}


function onSustainPedalChange(value) {
  // Update isSustainOn unless sustain latch is on
  isSustainOn = isLatchSustainOn || value === 127;
  if (isSustainOn) return;

  // Silence/Release all sustained notes
  for (const note of sustainedNoteList.values()) {
    // Silence sustained note
    output.send([buildMIDIHeader(NOTE_OFF_MSG, outputMidiChannel), note, 64]);
    // Release sustained note
    sustainedNoteList.delete(note);
  }
}


/** UTILS */

function addOptions(selector, text, value) {
  const option = document.createElement("option");
  option.text = text;
  option.value = value;
  selector.appendChild(option);
  selector.value = null;
}

function buildMIDIHeader(type, channel) {
  return (type << 4) + channel;
}

function splitMIDIHeader(chunk) {
  return [chunk >> 4, chunk & 0x0f];
}