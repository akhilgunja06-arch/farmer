import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Voice input and output, using the browser's own speech APIs.
 *
 * These are used because they are already on the device: a farmer reading a
 * Telugu answer on a mid-range Android phone can hear it instead of reading it,
 * and can speak a question instead of typing Telugu script. Nothing here sends
 * audio anywhere — the recognition happens on the device or through the
 * browser's own service, and no audio reaches RythuDirect's servers.
 *
 * Both APIs are unevenly supported, so each reports its own availability and the
 * interface hides a control rather than showing one that cannot work.
 */

/** BCP-47 tags the speech APIs expect for the languages we ship. */
const SPEECH_LOCALES: Record<string, string> = {
  en: 'en-IN',
  te: 'te-IN',
  hi: 'hi-IN',
};

/** Minimal shapes for the parts of the Web Speech API we use. */
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  0: SpeechRecognitionAlternative;
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResult>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface VoiceInput {
  supported: boolean;
  listening: boolean;
  /** Partial text while the farmer is still speaking. */
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

/**
 * Speech-to-text.
 *
 * `onFinal` receives the completed transcript; the caller decides whether to
 * append or replace the textarea contents.
 */
export function useVoiceInput(language: string, onFinal: (text: string) => void): VoiceInput {
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Kept in a ref so a language change does not tear down an active session.
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError('unsupported');
      return;
    }
    if (recognitionRef.current) recognitionRef.current.abort();

    const recognition = new Ctor();
    recognition.lang = SPEECH_LOCALES[language] ?? 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let finalText = '';
      let partial = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        if (result.isFinal) finalText += result[0].transcript;
        else partial += result[0].transcript;
      }
      setInterim(partial);
      if (finalText.trim()) {
        onFinalRef.current(finalText.trim());
        setInterim('');
      }
    };

    recognition.onerror = (event) => {
      // 'no-speech' and 'aborted' are ordinary: the farmer paused or cancelled.
      if (event.error && !['no-speech', 'aborted'].includes(event.error)) {
        setError(event.error);
      }
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      setInterim('');
    };

    recognitionRef.current = recognition;
    setError(null);
    setInterim('');
    try {
      recognition.start();
      setListening(true);
    } catch {
      // Starting twice in quick succession throws; treat it as already listening.
      setListening(false);
    }
  }, [language]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, interim, error, start, stop, toggle };
}

export interface VoiceOutput {
  supported: boolean;
  speaking: boolean;
  speak: (text: string) => void;
  stop: () => void;
}

/**
 * Text-to-speech.
 *
 * Answers are read in the interface language. The model is instructed to answer
 * in that language too, so the voice and the text match.
 */
export function useVoiceOutput(language: string): VoiceOutput {
  const [supported] = useState(
    () => typeof window !== 'undefined' && 'speechSynthesis' in window,
  );
  const [speaking, setSpeaking] = useState(false);

  // Cancel any utterance when the page unmounts, otherwise speech continues
  // after navigating away.
  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  const stop = useCallback(() => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!('speechSynthesis' in window) || !text.trim()) return;
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = SPEECH_LOCALES[language] ?? 'en-IN';
      utterance.rate = 0.95;
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);

      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    },
    [language],
  );

  return { supported, speaking, speak, stop };
}
