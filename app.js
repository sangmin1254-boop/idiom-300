/**
 * 초등 사자성어 300 마스터 & 오답노트 - 핵심 애플리케이션 로직 (app.js)
 * - 사자성어 사전 제거 완료 (맞춤형 퀴즈 & 완벽 오답노트 2개 핵심 모드 집중)
 * - 맞춤형 퀴즈 모드 (10/20/50/100/300문항, 한자->뜻 / 뜻->한자 / 랜덤 혼합)
 * - 카카오톡 인앱 브라우저에서도 잘리지 않는 상단·하단 2중 [다음 문제 ➡️] 스위치
 * - 실시간 풍부한 해설 피드백 (정답 해설 + 선택한 오답 뜻 비교 + 나머지 보기 뜻 안내)
 * - Web Audio API 기반 신디사이저 효과음 (외부 오디오 파일 불필요)
 * - 완벽한 오답노트 (자동 기록, 오답 횟수 표시, 오답 복습 전용 퀴즈)
 */

(function () {
  "use strict";

  // ==========================================================================
  // 1. 상태 관리 및 LocalStorage 키
  // ==========================================================================
  const STORAGE_KEYS = {
    WRONG_NOTES: "idiom300_wrong_notes_v1",     // { [id]: { count: number, updatedAt: string } }
    MASTERED_IDS: "idiom300_mastered_ids_v1",   // number[]
    SETTINGS: "idiom300_user_settings_v1"       // { soundEnabled: boolean, fontSize: 'normal'|'large'|'xlarge' }
  };

  let PUBLIC_GAME_URL = "https://litter.catbox.moe/b4xt3n.html";

  const state = {
    activeTab: "quiz",

    // 사용자 학습 데이터
    wrongNotes: {},     // id -> { count, updatedAt }
    masteredIds: new Set(),

    // 환경 설정
    soundEnabled: true,
    fontSize: "normal",

    // 퀴즈 설정 및 진행 상태
    quizConfig: {
      count: 10,
      type: "word_to_meaning", // 'word_to_meaning' | 'meaning_to_word' | 'mixed'
      isWrongReview: false
    },
    quizSession: {
      active: false,
      questions: [],      // 출제된 문제 배열
      currentIndex: 0,
      correctCount: 0,
      wrongCount: 0,
      wrongIdsThisSession: [],
      answeredCurrent: false,
      isWrongReview: false
    }
  };

  // ==========================================================================
  // 2. Web Audio API 신디사이저 효과음 엔진
  // ==========================================================================
  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  const SoundEffects = {
    playClick() {
      if (!state.soundEnabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(680, now + 0.045);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.055);
    },

    playCorrect() {
      if (!state.soundEnabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;

      const notes = [523.25, 659.25, 783.99, 1046.5];
      const now = ctx.currentTime;

      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const startTime = now + idx * 0.085;
        const duration = idx === notes.length - 1 ? 0.38 : 0.18;

        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.linearRampToValueAtTime(0.22, startTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration + 0.02);
      });
    },

    playWrong() {
      if (!state.soundEnabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;

      const notes = [311.13, 246.94];
      const now = ctx.currentTime;

      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const startTime = now + idx * 0.16;
        const duration = idx === 1 ? 0.32 : 0.14;

        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.linearRampToValueAtTime(0.14, startTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration + 0.02);
      });
    },

    playFanfare() {
      if (!state.soundEnabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;

      const melody = [
        { freq: 523.25, delay: 0, dur: 0.14 },
        { freq: 659.25, delay: 0.12, dur: 0.14 },
        { freq: 783.99, delay: 0.24, dur: 0.14 },
        { freq: 1046.5, delay: 0.36, dur: 0.45 }
      ];
      const now = ctx.currentTime;

      melody.forEach((note) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + note.delay;

        osc.type = "triangle";
        osc.frequency.setValueAtTime(note.freq, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.24, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + note.dur);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + note.dur + 0.02);
      });
    }
  };

  // ==========================================================================
  // 3. 한국어 음성 안내 (Web Speech API)
  // ==========================================================================
  function speakIdiom(idiom) {
    if (!("speechSynthesis" in window)) {
      showToast("현재 브라우저에서는 음성 읽기 기능을 지원하지 않습니다.");
      return;
    }
    window.speechSynthesis.cancel();
    const text = `${idiom.word}. ${idiom.meaning}`;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ko-KR";
    utter.rate = 0.92;
    utter.pitch = 1.0;
    window.speechSynthesis.speak(utter);
    showToast(`🔊 [${idiom.word}] 음성과 뜻을 읽어 드립니다.`);
  }

  // 배열 셔플 (Fisher-Yates)
  function shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // ==========================================================================
  // 4. 로컬 스토리지 저장 및 불러오기
  // ==========================================================================
  function loadPersistedData() {
    try {
      const savedWrong = localStorage.getItem(STORAGE_KEYS.WRONG_NOTES);
      if (savedWrong) {
        state.wrongNotes = JSON.parse(savedWrong) || {};
      }
      const savedMastered = localStorage.getItem(STORAGE_KEYS.MASTERED_IDS);
      if (savedMastered) {
        const arr = JSON.parse(savedMastered);
        if (Array.isArray(arr)) {
          state.masteredIds = new Set(arr);
        }
      }
      const savedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        if (typeof parsed.soundEnabled === "boolean") {
          state.soundEnabled = parsed.soundEnabled;
        }
        if (parsed.fontSize) {
          state.fontSize = parsed.fontSize;
        }
      }
    } catch (e) {
      console.warn("로컬 스토리지 데이터를 불러오는 중 오류 발생:", e);
    }
  }

  function saveWrongNotes() {
    try {
      localStorage.setItem(STORAGE_KEYS.WRONG_NOTES, JSON.stringify(state.wrongNotes));
    } catch (e) {}
    updateBadgesAndCounters();
  }

  function saveMasteredIds() {
    try {
      localStorage.setItem(STORAGE_KEYS.MASTERED_IDS, JSON.stringify([...state.masteredIds]));
    } catch (e) {}
    updateBadgesAndCounters();
  }

  function saveSettings() {
    try {
      localStorage.setItem(
        STORAGE_KEYS.SETTINGS,
        JSON.stringify({
          soundEnabled: state.soundEnabled,
          fontSize: state.fontSize
        })
      );
    } catch (e) {}
  }

  // ==========================================================================
  // 5. 상단 배지 및 토스트 알림 업데이트
  // ==========================================================================
  let toastTimer = null;
  function showToast(message) {
    const toastEl = document.getElementById("toastMessage");
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.remove("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.add("hidden");
    }, 2600);
  }

  function updateBadgesAndCounters() {
    const wrongCount = Object.keys(state.wrongNotes).length;

    const wrongBadge = document.getElementById("wrongCountBadge");
    if (wrongBadge) wrongBadge.textContent = wrongCount;

    const wnTotalCount = document.getElementById("wnTotalCount");
    if (wnTotalCount) wnTotalCount.textContent = `${wrongCount}개`;

    const setupWrongBtn = document.getElementById("startWrongQuizFromSetupBtn");
    const setupWrongCount = document.getElementById("setupWrongCount");
    if (setupWrongBtn && setupWrongCount) {
      setupWrongCount.textContent = wrongCount;
      if (wrongCount > 0) {
        setupWrongBtn.classList.remove("hidden");
      } else {
        setupWrongBtn.classList.add("hidden");
      }
    }
  }

  // ==========================================================================
  // 6. 맞춤형 퀴즈 생성 및 진행 엔진
  // ==========================================================================
  function startQuizSession({ count, type, isWrongReview = false }) {
    let pool = [];

    if (isWrongReview) {
      const wrongIds = Object.keys(state.wrongNotes).map((id) => Number(id));
      pool = IDIOMS_DATA.filter((item) => wrongIds.includes(item.id));
      if (pool.length === 0) {
        showToast("현재 오답노트에 저장된 사자성어가 없습니다!");
        return;
      }
    } else {
      pool = [...IDIOMS_DATA];
    }

    const shuffledPool = shuffleArray(pool);
    const targetCount = isWrongReview ? shuffledPool.length : Math.min(count, shuffledPool.length);
    const selectedItems = shuffledPool.slice(0, targetCount);

    const questions = selectedItems.map((targetItem) => {
      let questionType = type;
      if (type === "mixed") {
        questionType = Math.random() < 0.5 ? "word_to_meaning" : "meaning_to_word";
      }

      const sameCategoryOthers = IDIOMS_DATA.filter(
        (it) => it.id !== targetItem.id && it.category === targetItem.category
      );
      const otherIdioms = IDIOMS_DATA.filter(
        (it) => it.id !== targetItem.id && it.category !== targetItem.category
      );

      const candidateDistractors = [
        ...shuffleArray(sameCategoryOthers).slice(0, 2),
        ...shuffleArray(otherIdioms)
      ];
      const distractors = candidateDistractors.slice(0, 3);
      const choices = shuffleArray([targetItem, ...distractors]);

      return {
        target: targetItem,
        questionType,
        choices
      };
    });

    state.quizSession = {
      active: true,
      questions,
      currentIndex: 0,
      correctCount: 0,
      wrongCount: 0,
      wrongIdsThisSession: [],
      answeredCurrent: false,
      isWrongReview
    };

    switchTab("quiz", true);
    document.getElementById("quizSetupView").classList.add("hidden");
    document.getElementById("quizResultView").classList.add("hidden");
    document.getElementById("quizPlayView").classList.remove("hidden");

    const modeBadge = document.getElementById("quizCurrentModeBadge");
    if (isWrongReview) {
      modeBadge.textContent = `📝 오답 복습 퀴즈 (${questions.length}문항)`;
    } else {
      const typeLabels = {
        word_to_meaning: "📜 한자 보고 뜻 맞히기",
        meaning_to_word: "💡 뜻 보고 한자 맞히기",
        mixed: "🔀 랜덤 혼합 모드"
      };
      modeBadge.textContent = `${typeLabels[type]} (${questions.length}문항)`;
    }

    renderCurrentQuizQuestion();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderCurrentQuizQuestion() {
    const session = state.quizSession;
    const currentQ = session.questions[session.currentIndex];
    if (!currentQ) return;

    session.answeredCurrent = false;

    const total = session.questions.length;
    const currentNum = session.currentIndex + 1;
    const percent = Math.round((currentNum / total) * 100);

    document.getElementById("liveCorrectCount").textContent = session.correctCount;
    document.getElementById("liveWrongCount").textContent = session.wrongCount;
    document.getElementById("quizProgressText").textContent = `제 ${currentNum} / ${total} 문제`;
    document.getElementById("quizPercentText").textContent = `${percent}%`;
    document.getElementById("quizProgressBar").style.width = `${percent}%`;

    const instructionEl = document.getElementById("questionInstruction");
    const promptEl = document.getElementById("questionPrompt");
    const subEl = document.getElementById("questionSub");

    if (currentQ.questionType === "word_to_meaning") {
      instructionEl.textContent = "다음 사자성어가 가진 알맞은 뜻은 무엇일까요?";
      promptEl.className = "question-prompt";
      promptEl.textContent = currentQ.target.hanja;
      subEl.textContent = `${currentQ.target.word} (${currentQ.target.category})`;
    } else {
      instructionEl.textContent = "다음 뜻풀이에 해당하는 알맞은 사자성어는 무엇일까요?";
      promptEl.className = "question-prompt meaning-prompt";
      promptEl.textContent = `“${currentQ.target.meaning}”`;
      subEl.textContent = `주제 분류: ${currentQ.target.category}`;
    }

    const choicesContainer = document.getElementById("choicesContainer");
    choicesContainer.innerHTML = "";

    currentQ.choices.forEach((choiceItem, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-btn";
      btn.dataset.choiceId = choiceItem.id;

      let choiceLabelHtml = "";
      if (currentQ.questionType === "word_to_meaning") {
        choiceLabelHtml = `<span class="choice-text">${choiceItem.meaning}</span>`;
      } else {
        choiceLabelHtml = `
          <span class="choice-text">
            <strong>${choiceItem.word}</strong>
            <span class="choice-hanja-inline">(${choiceItem.hanja})</span>
          </span>
        `;
      }

      btn.innerHTML = `
        <span class="choice-num">${idx + 1}</span>
        ${choiceLabelHtml}
      `;

      btn.addEventListener("click", () => handleSelectAnswer(choiceItem));
      choicesContainer.appendChild(btn);
    });

    document.getElementById("feedbackPanel").classList.add("hidden");
  }

  function handleSelectAnswer(selectedItem) {
    const session = state.quizSession;
    if (session.answeredCurrent) return;
    session.answeredCurrent = true;

    const currentQ = session.questions[session.currentIndex];
    const targetItem = currentQ.target;
    const isCorrect = selectedItem.id === targetItem.id;

    const choiceBtns = document.querySelectorAll("#choicesContainer .choice-btn");
    choiceBtns.forEach((btn) => {
      btn.disabled = true;
      const cid = Number(btn.dataset.choiceId);
      if (cid === targetItem.id) {
        btn.classList.add("is-correct");
      } else if (cid === selectedItem.id && !isCorrect) {
        btn.classList.add("is-wrong");
      }
    });

    if (isCorrect) {
      session.correctCount += 1;
      SoundEffects.playCorrect();

      if (session.isWrongReview && state.wrongNotes[targetItem.id]) {
        delete state.wrongNotes[targetItem.id];
        state.masteredIds.add(targetItem.id);
        saveWrongNotes();
        saveMasteredIds();
      }
    } else {
      session.wrongCount += 1;
      if (!session.wrongIdsThisSession.includes(targetItem.id)) {
        session.wrongIdsThisSession.push(targetItem.id);
      }
      SoundEffects.playWrong();

      const prevCount = state.wrongNotes[targetItem.id]?.count || 0;
      state.wrongNotes[targetItem.id] = {
        count: prevCount + 1,
        updatedAt: new Date().toLocaleDateString("ko-KR")
      };
      saveWrongNotes();
    }

    document.getElementById("liveCorrectCount").textContent = session.correctCount;
    document.getElementById("liveWrongCount").textContent = session.wrongCount;

    renderRichFeedback(currentQ, selectedItem, isCorrect);
  }

  function renderRichFeedback(currentQ, selectedItem, isCorrect) {
    const target = currentQ.target;
    const feedbackPanel = document.getElementById("feedbackPanel");
    const banner = document.getElementById("feedbackBanner");
    const icon = document.getElementById("feedbackIcon");
    const title = document.getElementById("feedbackTitle");
    const subtitle = document.getElementById("feedbackSubtitle");

    if (isCorrect) {
      banner.className = "feedback-banner correct-banner";
      icon.textContent = "⭕";
      title.textContent = "정답입니다! 참 잘하셨습니다!";
      if (state.quizSession.isWrongReview) {
        subtitle.textContent = `🎉 [${target.word}] 단어가 오답노트에서 졸업되었습니다!`;
      } else {
        subtitle.textContent = `[${target.word}(${target.hanja})]의 뜻을 정확히 맞히셨습니다.`;
      }
    } else {
      banner.className = "feedback-banner wrong-banner";
      icon.textContent = "❌";
      title.textContent = `아쉽습니다! 정답은 [${target.word}(${target.hanja})]입니다.`;
      subtitle.textContent = `📌 [${target.word}] 단어를 오답노트에 자동 기록했습니다.`;
    }

    // 1) 정답 상세 해설
    document.getElementById("explainCorrectWord").textContent = target.word;
    document.getElementById("explainCorrectHanja").textContent = `(${target.hanja})`;
    document.getElementById("explainCorrectCategory").textContent = target.category;
    document.getElementById("explainCorrectMeaning").textContent = `👉 ${target.meaning}`;

    // 2) 내가 고른 오답 사자성어 상세 해설
    const wrongDetailBox = document.getElementById("wrongChoiceDetailBox");
    if (!isCorrect) {
      wrongDetailBox.classList.remove("hidden");
      document.getElementById("explainSelectedWord").textContent = selectedItem.word;
      document.getElementById("explainSelectedHanja").textContent = `(${selectedItem.hanja})`;
      document.getElementById("explainSelectedCategory").textContent = selectedItem.category;
      document.getElementById("explainSelectedMeaning").textContent =
        `선택하신 [${selectedItem.word}(${selectedItem.hanja})]은(는) “${selectedItem.meaning}”라는 뜻입니다.`;
    } else {
      wrongDetailBox.classList.add("hidden");
    }

    // 3) 함께 출제된 나머지 보기 뜻 비교 리스트
    const otherListEl = document.getElementById("otherOptionsList");
    otherListEl.innerHTML = "";
    currentQ.choices.forEach((choice) => {
      if (choice.id === target.id) return;
      if (!isCorrect && choice.id === selectedItem.id) return;

      const li = document.createElement("li");
      li.innerHTML = `<strong>${choice.word}(${choice.hanja})</strong>: ${choice.meaning}`;
      otherListEl.appendChild(li);
    });

    // 상단 & 하단 2중 [다음 문제] 스위치 문구 동기화
    const nextBtn = document.getElementById("nextQuestionBtn");
    const nextTopBtn = document.getElementById("nextQuestionTopBtn");
    const isLast = state.quizSession.currentIndex + 1 >= state.quizSession.questions.length;

    if (isLast) {
      nextBtn.textContent = "🏁 퀴즈 결과 및 점수 확인하기 ➡️";
      if (nextTopBtn) nextTopBtn.textContent = "🏁 결과 확인 ➡️";
    } else {
      nextBtn.textContent = "다음 문제로 넘어가기 ➡️";
      if (nextTopBtn) nextTopBtn.textContent = "다음 문제 ➡️";
    }

    feedbackPanel.classList.remove("hidden");
    // 카카오톡 모바일 화면에서 해설과 다음 문제 스위치가 즉시 보이도록 스크롤 이동
    setTimeout(() => {
      feedbackPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  }

  function goToNextQuestion() {
    SoundEffects.playClick();
    const session = state.quizSession;
    if (session.currentIndex + 1 < session.questions.length) {
      session.currentIndex += 1;
      renderCurrentQuizQuestion();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      finishQuizSession();
    }
  }

  function finishQuizSession() {
    const session = state.quizSession;
    session.active = false;

    SoundEffects.playFanfare();

    document.getElementById("quizPlayView").classList.add("hidden");
    document.getElementById("quizResultView").classList.remove("hidden");

    const total = session.questions.length;
    const correct = session.correctCount;
    const wrong = session.wrongCount;
    const score = Math.round((correct / total) * 100);

    document.getElementById("resTotalCount").textContent = `${total}문제`;
    document.getElementById("resCorrectCount").textContent = `${correct}문제`;
    document.getElementById("resWrongCount").textContent = `${wrong}문제`;
    document.getElementById("resFinalScore").textContent = `${score}점`;

    const medalEl = document.getElementById("resultMedal");
    const titleEl = document.getElementById("resultTitle");
    const msgEl = document.getElementById("resultMessage");

    if (score === 100) {
      medalEl.textContent = "👑";
      titleEl.textContent = "백점 만점! 사자성어 박사님이십니다!";
      msgEl.textContent = "출제된 모든 사자성어의 음과 뜻을 완벽하게 꿰뚫고 계십니다!";
    } else if (score >= 80) {
      medalEl.textContent = "🏆";
      titleEl.textContent = "참 잘하셨습니다! 훌륭한 실력이십니다!";
      msgEl.textContent = "대부분의 사자성어를 정확히 알고 계십니다. 아쉽게 틀린 문제만 오답노트에서 복습해 보세요.";
    } else if (score >= 50) {
      medalEl.textContent = "👏";
      titleEl.textContent = "수고하셨습니다! 꾸준히 실력이 늘고 있습니다!";
      msgEl.textContent = "헷갈렸던 사자성어들이 오답노트에 정리되어 있습니다. 한 번 더 복습하면 금방 내 것이 됩니다!";
    } else {
      medalEl.textContent = "🌱";
      titleEl.textContent = "좋은 시작입니다! 하나씩 익혀 보세요!";
      msgEl.textContent = "오답노트에 기록된 단어들을 천천히 읽어보며 복습 퀴즈에 다시 도전해 보세요!";
    }

    const wrongNotice = document.getElementById("resultWrongNotice");
    const retryWrongBtn = document.getElementById("retryWrongFromResultBtn");
    const totalStoredWrong = Object.keys(state.wrongNotes).length;

    if (wrong > 0 || totalStoredWrong > 0) {
      wrongNotice.classList.remove("hidden");
      retryWrongBtn.classList.remove("hidden");
      retryWrongBtn.textContent = `📝 오답노트 복습 퀴즈 풀기 (총 ${totalStoredWrong}문제)`;
    } else {
      wrongNotice.classList.add("hidden");
      retryWrongBtn.classList.add("hidden");
    }

    renderWrongNoteSection();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ==========================================================================
  // 7. 완벽한 오답노트 렌더링 및 관리
  // ==========================================================================
  function renderWrongNoteSection() {
    const grid = document.getElementById("wrongNoteGrid");
    const emptyState = document.getElementById("wrongNoteEmptyState");
    const controlPanel = document.getElementById("wrongQuizControlPanel");
    const toolbar = document.getElementById("wrongnoteToolbar");

    const wrongIds = Object.keys(state.wrongNotes).map((id) => Number(id));
    const wrongItems = IDIOMS_DATA.filter((item) => wrongIds.includes(item.id));

    wrongItems.sort((a, b) => {
      const countA = state.wrongNotes[a.id]?.count || 1;
      const countB = state.wrongNotes[b.id]?.count || 1;
      return countB - countA;
    });

    if (wrongItems.length === 0) {
      grid.innerHTML = "";
      grid.classList.add("hidden");
      controlPanel.classList.add("hidden");
      toolbar.classList.add("hidden");
      emptyState.classList.remove("hidden");
      return;
    }

    grid.classList.remove("hidden");
    controlPanel.classList.remove("hidden");
    toolbar.classList.remove("hidden");
    emptyState.classList.add("hidden");

    const fragment = document.createDocumentFragment();

    wrongItems.forEach((item) => {
      const meta = state.wrongNotes[item.id] || { count: 1, updatedAt: "" };
      const card = document.createElement("article");
      card.className = "idiom-card is-wrong";

      card.innerHTML = `
        <div>
          <div class="card-top">
            <span class="wrong-meta-badge">❗ 누적 오답 ${meta.count}회</span>
            <span class="card-category">${item.category}</span>
          </div>
          <div class="card-main-word">
            <span class="card-hanja">${item.hanja}</span>
            <strong class="card-hangul">${item.word}</strong>
          </div>
          <div class="card-meaning-box">
            <p class="card-meaning">${item.meaning}</p>
          </div>
        </div>
        <div class="card-actions">
          <button type="button" class="card-btn speak-btn" data-id="${item.id}">
            🔊 발음·뜻 듣기
          </button>
          <button type="button" class="card-btn master-btn active graduate-btn" data-id="${item.id}">
            완벽히 외웠어요 ✅ (오답 졸업)
          </button>
        </div>
      `;

      card.querySelector(".speak-btn").addEventListener("click", () => {
        speakIdiom(item);
      });

      card.querySelector(".graduate-btn").addEventListener("click", () => {
        SoundEffects.playCorrect();
        delete state.wrongNotes[item.id];
        state.masteredIds.add(item.id);
        saveWrongNotes();
        saveMasteredIds();
        renderWrongNoteSection();
        showToast(`🎉 축하합니다! [${item.word}] 단어를 완벽히 외워 오답노트에서 졸업했습니다!`);
      });

      fragment.appendChild(card);
    });

    grid.innerHTML = "";
    grid.appendChild(fragment);
  }

  // ==========================================================================
  // 8. 탭 전환 및 이벤트 바인딩
  // ==========================================================================
  function switchTab(tabName, keepQuizView = false) {
    state.activeTab = tabName;

    document.querySelectorAll(".nav-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });

    document.querySelectorAll(".tab-section").forEach((sec) => {
      sec.classList.toggle("active", sec.id === `section-${tabName}`);
    });

    if (tabName === "quiz" && !keepQuizView && !state.quizSession.active) {
      document.getElementById("quizSetupView").classList.remove("hidden");
      document.getElementById("quizPlayView").classList.add("hidden");
      document.getElementById("quizResultView").classList.add("hidden");
    }

    if (tabName === "wrongnote") {
      renderWrongNoteSection();
    }
  }

  function applySettingsUI() {
    document.body.classList.remove("font-size-normal", "font-size-large", "font-size-xlarge");
    document.body.classList.add(`font-size-${state.fontSize}`);

    document.querySelectorAll(".font-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.size === state.fontSize);
    });

    const soundBtn = document.getElementById("soundToggleBtn");
    const soundIcon = document.getElementById("soundIcon");
    const soundText = document.getElementById("soundText");
    if (soundBtn) {
      soundBtn.classList.toggle("active", state.soundEnabled);
      soundBtn.setAttribute("aria-pressed", String(state.soundEnabled));
      soundIcon.textContent = state.soundEnabled ? "🔊" : "🔇";
      soundText.textContent = state.soundEnabled ? "효과음 켜짐" : "효과음 꺼짐";
    }
  }

  function bindEvents() {
    // 홈 로고 클릭 시 퀴즈 메인 화면으로
    document.getElementById("brandHomeBtn").addEventListener("click", () => {
      SoundEffects.playClick();
      state.quizSession.active = false;
      switchTab("quiz", false);
    });

    // 카톡 공유(주소복사) 버튼
    const shareLinkBtn = document.getElementById("shareLinkBtn");
    if (shareLinkBtn) {
      shareLinkBtn.addEventListener("click", async () => {
        SoundEffects.playClick();
        const targetUrl = window.location.protocol.startsWith("http")
          ? window.location.href
          : PUBLIC_GAME_URL;

        const shareData = {
          title: "📜 초등 사자성어 300 마스터 & 오답노트",
          text: "시니어 맞춤형 큰 글씨 사자성어 300선 퀴즈 & 오답 복습 게임! 아래 주소를 눌러 함께 풀어보세요.",
          url: targetUrl
        };
        if (navigator.share && window.location.protocol.startsWith("http")) {
          try {
            await navigator.share(shareData);
            return;
          } catch (e) {}
        }
        try {
          await navigator.clipboard.writeText(targetUrl);
          showToast("📋 카카오톡 공유용 인터넷 주소가 복사되었습니다! 채팅방에 붙여넣기 하세요.");
        } catch (err) {
          showToast("카톡 공유 주소: " + targetUrl);
        }
      });
    }

    // 메인 탭 전환
    document.querySelectorAll(".nav-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        SoundEffects.playClick();
        switchTab(btn.dataset.tab);
      });
    });

    // 효과음 켜기/끄기
    document.getElementById("soundToggleBtn").addEventListener("click", () => {
      state.soundEnabled = !state.soundEnabled;
      saveSettings();
      applySettingsUI();
      if (state.soundEnabled) {
        SoundEffects.playClick();
        showToast("🔊 신디사이저 효과음이 켜졌습니다.");
      } else {
        showToast("🔇 효과음이 꺼졌습니다.");
      }
    });

    // 글씨 크기 변경
    document.querySelectorAll(".font-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        SoundEffects.playClick();
        state.fontSize = btn.dataset.size;
        saveSettings();
        applySettingsUI();
        const labelMap = { normal: "보통 글씨", large: "큰 글씨", xlarge: "특대 글씨" };
        showToast(`🔎 화면 글자 크기를 [${labelMap[state.fontSize]}]로 변경했습니다.`);
      });
    });

    // 퀴즈 설정: 문항 수 선택
    document.querySelectorAll("#quizCountGroup .setup-option-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        SoundEffects.playClick();
        state.quizConfig.count = Number(btn.dataset.count);
        document.querySelectorAll("#quizCountGroup .setup-option-btn").forEach((b) => {
          b.classList.toggle("active", b === btn);
        });
      });
    });

    // 퀴즈 설정: 유형 선택
    document.querySelectorAll("#quizTypeGroup .setup-option-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        SoundEffects.playClick();
        state.quizConfig.type = btn.dataset.type;
        document.querySelectorAll("#quizTypeGroup .setup-option-btn").forEach((b) => {
          b.classList.toggle("active", b === btn);
        });
      });
    });

    // 퀴즈 시작 버튼
    document.getElementById("startQuizBtn").addEventListener("click", () => {
      SoundEffects.playClick();
      startQuizSession({
        count: state.quizConfig.count,
        type: state.quizConfig.type,
        isWrongReview: false
      });
    });

    // 퀴즈 설정 화면 내 오답 복습 시작 버튼
    document.getElementById("startWrongQuizFromSetupBtn").addEventListener("click", () => {
      SoundEffects.playClick();
      startQuizSession({
        count: 300,
        type: state.quizConfig.type,
        isWrongReview: true
      });
    });

    // 퀴즈 도중 종료(설정으로) 버튼
    document.getElementById("quitQuizBtn").addEventListener("click", () => {
      SoundEffects.playClick();
      state.quizSession.active = false;
      document.getElementById("quizPlayView").classList.add("hidden");
      document.getElementById("quizSetupView").classList.remove("hidden");
    });

    // 다음 문제 스위치 (상단 & 하단 2중 스위치 모두 연결)
    document.getElementById("nextQuestionBtn").addEventListener("click", goToNextQuestion);
    const nextTopBtn = document.getElementById("nextQuestionTopBtn");
    if (nextTopBtn) {
      nextTopBtn.addEventListener("click", goToNextQuestion);
    }

    // 결과 화면 버튼들
    document.getElementById("retryWrongFromResultBtn").addEventListener("click", () => {
      SoundEffects.playClick();
      startQuizSession({
        count: 300,
        type: "mixed",
        isWrongReview: true
      });
    });

    document.getElementById("restartNewQuizBtn").addEventListener("click", () => {
      SoundEffects.playClick();
      document.getElementById("quizResultView").classList.add("hidden");
      document.getElementById("quizSetupView").classList.remove("hidden");
    });

    document.getElementById("goToWrongNoteBtn").addEventListener("click", () => {
      SoundEffects.playClick();
      switchTab("wrongnote");
    });

    // 오답노트 탭 내 복습 퀴즈 버튼 3종
    document.getElementById("startWrongReviewQuizMixedBtn").addEventListener("click", () => {
      SoundEffects.playClick();
      startQuizSession({ count: 300, type: "mixed", isWrongReview: true });
    });

    document.getElementById("startWrongReviewWordBtn").addEventListener("click", () => {
      SoundEffects.playClick();
      startQuizSession({ count: 300, type: "word_to_meaning", isWrongReview: true });
    });

    document.getElementById("startWrongReviewMeaningBtn").addEventListener("click", () => {
      SoundEffects.playClick();
      startQuizSession({ count: 300, type: "meaning_to_word", isWrongReview: true });
    });

    // 오답노트 전체 비우기
    document.getElementById("clearAllWrongBtn").addEventListener("click", () => {
      SoundEffects.playClick();
      if (Object.keys(state.wrongNotes).length === 0) return;
      if (window.confirm("오답노트에 저장된 모든 사자성어를 비우시겠습니까?")) {
        state.wrongNotes = {};
        saveWrongNotes();
        renderWrongNoteSection();
        showToast("🗑️ 오답노트를 모두 비웠습니다.");
      }
    });

    // 오답노트 빈 화면에서 퀴즈 풀러 가기
    document.getElementById("goToQuizFromEmptyBtn").addEventListener("click", () => {
      SoundEffects.playClick();
      switchTab("quiz");
    });
  }

  // ==========================================================================
  // 9. 앱 초기화
  // ==========================================================================
  function init() {
    loadPersistedData();
    applySettingsUI();
    updateBadgesAndCounters();
    renderWrongNoteSection();
    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
