/**
 * 초등 사자성어 300 마스터 & 오답노트 - 핵심 애플리케이션 로직 (app.js)
 * - 300선 사자성어 사전 (검색, 초성 필터, 학습 상태 필터, 뜻 가리기 암기 모드, 음성 듣기)
 * - 맞춤형 퀴즈 모드 (10/20/50/100/300문항, 한자->뜻 / 뜻->한자 / 랜덤 혼합)
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
    WRONG_NOTES: "idiom300_wrong_notes_v1",     // { [id]: { wrongCount: number, lastWrongAt: string } }
    MASTERED_IDS: "idiom300_mastered_ids_v1",   // number[]
    SETTINGS: "idiom300_user_settings_v1"       // { soundEnabled: boolean, fontSize: 'normal'|'large'|'xlarge' }
  };

  const state = {
    activeTab: "dictionary",
    // 사전 필터 상태
    searchQuery: "",
    selectedChosung: "ALL",
    statusFilter: "all", // 'all' | 'unmastered' | 'mastered' | 'wrong'
    blindMeaningMode: false,

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
      answeredCurrent: false
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
    // 버튼 클릭 시 가벼운 나무 탁자 터치음
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

    // 정답 시 경쾌한 3화음 실로폰/차임벨 팡파르 (도-미-솔-높은도)
    playCorrect() {
      if (!state.soundEnabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;

      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
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

    // 오답 시 부드럽고 명확한 알림음 (귀가 아프지 않은 저음 2단 버저)
    playWrong() {
      if (!state.soundEnabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;

      const notes = [311.13, 246.94]; // D#4 -> B3
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

    // 퀴즈 완료 축하 팡파르
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
  // 3. 한국어 음성 안내 (Web Speech API - 시니어 편의 기능)
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
    utter.rate = 0.92; // 시니어분들이 듣기 편하도록 약간 여유 있는 속도
    utter.pitch = 1.0;
    window.speechSynthesis.speak(utter);
    showToast(`🔊 [${idiom.word}] 음성과 뜻을 읽어 드립니다.`);
  }

  // ==========================================================================
  // 4. 한글 초성 추출 유틸리티
  // ==========================================================================
  const CHOSUNG_LIST = [
    "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ",
    "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"
  ];

  function getFirstChosung(word) {
    if (!word || word.length === 0) return "";
    const code = word.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) return word[0];
    const chosungIndex = Math.floor(code / 588);
    const raw = CHOSUNG_LIST[chosungIndex];
    // 쌍자음은 기본 자음 탭에 통합
    const map = { "ㄲ": "ㄱ", "ㄸ": "ㄷ", "ㅃ": "ㅂ", "ㅆ": "ㅅ", "ㅉ": "ㅈ" };
    return map[raw] || raw;
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
  // 5. 로컬 스토리지 저장 및 불러오기
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
  // 6. 상단 배지, 오늘의 사자성어, 토스트 알림 업데이트
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
    const masteredCount = state.masteredIds.size;

    const wrongBadge = document.getElementById("wrongCountBadge");
    if (wrongBadge) wrongBadge.textContent = wrongCount;

    const masteredText = document.getElementById("masteredCountText");
    if (masteredText) masteredText.textContent = masteredCount;

    const wnTotalCount = document.getElementById("wnTotalCount");
    if (wnTotalCount) wnTotalCount.textContent = `${wrongCount}개`;

    // 퀴즈 설정 화면 내 오답 복습 바로가기 버튼 표시 여부
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

  function renderRandomTodayIdiom() {
    const randomItem = IDIOMS_DATA[Math.floor(Math.random() * IDIOMS_DATA.length)];
    if (!randomItem) return;
    document.getElementById("todayHanja").textContent = randomItem.hanja;
    document.getElementById("todayWord").textContent = randomItem.word;
    document.getElementById("todayMeaning").textContent = randomItem.meaning;
  }

  // ==========================================================================
  // 7. 300선 사자성어 사전 렌더링 및 검색/필터
  // ==========================================================================
  function getFilteredIdioms() {
    const query = state.searchQuery.trim().toLowerCase();

    return IDIOMS_DATA.filter((item) => {
      // 1) 초성 필터
      if (state.selectedChosung !== "ALL") {
        if (getFirstChosung(item.word) !== state.selectedChosung) {
          return false;
        }
      }

      // 2) 학습 상태 필터
      const isMastered = state.masteredIds.has(item.id);
      const isWrong = Boolean(state.wrongNotes[item.id]);

      if (state.statusFilter === "mastered" && !isMastered) return false;
      if (state.statusFilter === "unmastered" && isMastered) return false;
      if (state.statusFilter === "wrong" && !isWrong) return false;

      // 3) 검색어 필터 (음, 한자, 뜻, 카테고리)
      if (query) {
        const matchWord = item.word.toLowerCase().includes(query);
        const matchHanja = item.hanja.toLowerCase().includes(query);
        const matchMeaning = item.meaning.toLowerCase().includes(query);
        const matchCategory = item.category.toLowerCase().includes(query);
        return matchWord || matchHanja || matchMeaning || matchCategory;
      }

      return true;
    });
  }

  function renderDictionary() {
    const grid = document.getElementById("dictionaryGrid");
    const emptyState = document.getElementById("dictEmptyState");
    const filteredCountText = document.getElementById("filteredCountText");

    const filtered = getFilteredIdioms();
    filteredCountText.textContent = filtered.length;

    if (filtered.length === 0) {
      grid.innerHTML = "";
      emptyState.classList.remove("hidden");
      return;
    }

    emptyState.classList.add("hidden");

    const fragment = document.createDocumentFragment();

    filtered.forEach((item) => {
      const isMastered = state.masteredIds.has(item.id);
      const isWrong = Boolean(state.wrongNotes[item.id]);

      const card = document.createElement("article");
      card.className = `idiom-card ${isMastered ? "is-mastered" : ""} ${isWrong ? "is-wrong" : ""}`;

      const meaningBoxClass = state.blindMeaningMode
        ? "card-meaning-box blind-mode"
        : "card-meaning-box";

      card.innerHTML = `
        <div>
          <div class="card-top">
            <span class="card-num-badge">제 ${item.id}번</span>
            <span class="card-category">${item.category}</span>
          </div>
          <div class="card-main-word">
            <span class="card-hanja">${item.hanja}</span>
            <strong class="card-hangul">${item.word}</strong>
          </div>
          <div class="${meaningBoxClass}" data-role="meaning-box">
            <p class="card-meaning">${item.meaning}</p>
          </div>
        </div>
        <div class="card-actions">
          <button type="button" class="card-btn speak-btn" data-id="${item.id}" title="음성으로 듣기">
            🔊 발음·뜻 듣기
          </button>
          <button type="button" class="card-btn master-btn ${isMastered ? "active" : ""}" data-id="${item.id}">
            ${isMastered ? "⭐ 암기 완료됨" : "☆ 암기 완료 표시"}
          </button>
          <button type="button" class="card-btn wrong-toggle-btn ${isWrong ? "active" : ""}" data-id="${item.id}">
            ${isWrong ? "📌 오답노트 보관중" : "📌 오답노트 담기"}
          </button>
        </div>
      `;

      // 뜻 가리기 모드에서 클릭 시 뜻 보여주기
      const meaningBox = card.querySelector('[data-role="meaning-box"]');
      meaningBox.addEventListener("click", () => {
        if (state.blindMeaningMode) {
          SoundEffects.playClick();
          meaningBox.classList.toggle("revealed");
        }
      });

      // 음성 듣기 버튼
      card.querySelector(".speak-btn").addEventListener("click", () => {
        speakIdiom(item);
      });

      // 암기 완료 토글 버튼
      card.querySelector(".master-btn").addEventListener("click", () => {
        SoundEffects.playClick();
        if (state.masteredIds.has(item.id)) {
          state.masteredIds.delete(item.id);
          showToast(`[${item.word}] 암기 완료 표시를 해제했습니다.`);
        } else {
          state.masteredIds.add(item.id);
          showToast(`⭐ [${item.word}] 단어를 암기 완료로 표시했습니다!`);
        }
        saveMasteredIds();
        renderDictionary();
      });

      // 오답노트 수동 담기/해제 버튼
      card.querySelector(".wrong-toggle-btn").addEventListener("click", () => {
        SoundEffects.playClick();
        if (state.wrongNotes[item.id]) {
          delete state.wrongNotes[item.id];
          showToast(`[${item.word}] 단어를 오답노트에서 제외했습니다.`);
        } else {
          state.wrongNotes[item.id] = {
            count: 1,
            updatedAt: new Date().toLocaleDateString("ko-KR")
          };
          showToast(`📌 [${item.word}] 단어를 오답노트에 저장했습니다.`);
        }
        saveWrongNotes();
        renderDictionary();
        renderWrongNoteSection();
      });

      fragment.appendChild(card);
    });

    grid.innerHTML = "";
    grid.appendChild(fragment);
  }

  // ==========================================================================
  // 8. 맞춤형 퀴즈 생성 및 진행 엔진
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

    // 각 문항에 대해 4지선다 보기 생성
    const questions = selectedItems.map((targetItem) => {
      // 문제 유형 결정
      let questionType = type;
      if (type === "mixed") {
        questionType = Math.random() < 0.5 ? "word_to_meaning" : "meaning_to_word";
      }

      // 오답 보기 3개 추출 (같은 카테고리 우선 배정 후 부족하면 전체에서 랜덤 추출하여 학습 효과 향상)
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

    // 퀴즈 탭으로 이동 및 플레이 화면 활성화
    switchTab("quiz", true);
    document.getElementById("quizSetupView").classList.add("hidden");
    document.getElementById("quizResultView").classList.add("hidden");
    document.getElementById("quizPlayView").classList.remove("hidden");

    const modeBadge = document.getElementById("quizCurrentModeBadge");
    if (isWrongReview) {
      modeBadge.textContent = `📝 오답노트 집중 복습 퀴즈 (${questions.length}문항)`;
    } else {
      const typeLabels = {
        word_to_meaning: "📜 한자어 보고 뜻 맞히기",
        meaning_to_word: "💡 뜻 보고 한자어 맞히기",
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

    // 상단 스코어 및 진행률 업데이트
    const total = session.questions.length;
    const currentNum = session.currentIndex + 1;
    const percent = Math.round((currentNum / total) * 100);

    document.getElementById("liveCorrectCount").textContent = session.correctCount;
    document.getElementById("liveWrongCount").textContent = session.wrongCount;
    document.getElementById("quizProgressText").textContent = `제 ${currentNum} / ${total} 문제`;
    document.getElementById("quizPercentText").textContent = `${percent}%`;
    document.getElementById("quizProgressBar").style.width = `${percent}%`;

    // 질문 영역 렌더링
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

    // 4지선다 보기 버튼 생성
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

    // 해설 피드백 패널 숨기기
    document.getElementById("feedbackPanel").classList.add("hidden");
  }

  function handleSelectAnswer(selectedItem) {
    const session = state.quizSession;
    if (session.answeredCurrent) return;
    session.answeredCurrent = true;

    const currentQ = session.questions[session.currentIndex];
    const targetItem = currentQ.target;
    const isCorrect = selectedItem.id === targetItem.id;

    // 보기 버튼 스타일 업데이트 및 비활성화
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

    // 점수 및 오답노트 자동 반영
    if (isCorrect) {
      session.correctCount += 1;
      SoundEffects.playCorrect();

      // 오답 복습 퀴즈에서 맞힌 경우 오답노트에서 자동 졸업시킬지 안내와 함께 처리
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

      // 틀린 문제 오답노트에 자동 기록
      const prevCount = state.wrongNotes[targetItem.id]?.count || 0;
      state.wrongNotes[targetItem.id] = {
        count: prevCount + 1,
        updatedAt: new Date().toLocaleDateString("ko-KR")
      };
      saveWrongNotes();
    }

    document.getElementById("liveCorrectCount").textContent = session.correctCount;
    document.getElementById("liveWrongCount").textContent = session.wrongCount;

    // 즉각적이고 풍부한 해설 패널 렌더링
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
      title.textContent = "정답입니다! 아주 정확하게 맞히셨습니다!";
      if (state.quizSession.isWrongReview) {
        subtitle.textContent = `🎉 [${target.word}] 단어를 완벽히 복습하여 오답노트에서 졸업하고 암기 완료로 등록되었습니다!`;
      } else {
        subtitle.textContent = `정답 사자성어 [${target.word}(${target.hanja})]의 뜻과 다른 보기도 함께 확인해 보세요.`;
      }
    } else {
      banner.className = "feedback-banner wrong-banner";
      icon.textContent = "❌";
      title.textContent = `아쉽습니다! 정답은 [${target.word}(${target.hanja})]입니다.`;
      subtitle.textContent = `📌 언제든 다시 복습하실 수 있도록 [${target.word}] 단어를 오답노트에 자동으로 기록해 두었습니다.`;
    }

    // 1) 정답 상세 해설
    document.getElementById("explainCorrectWord").textContent = target.word;
    document.getElementById("explainCorrectHanja").textContent = `(${target.hanja})`;
    document.getElementById("explainCorrectCategory").textContent = target.category;
    document.getElementById("explainCorrectMeaning").textContent = `👉 ${target.meaning}`;

    // 2) 내가 고른 오답 사자성어 상세 해설 (오답을 골랐을 때 왜 틀렸는지 친절히 비교 설명)
    const wrongDetailBox = document.getElementById("wrongChoiceDetailBox");
    if (!isCorrect) {
      wrongDetailBox.classList.remove("hidden");
      document.getElementById("explainSelectedWord").textContent = selectedItem.word;
      document.getElementById("explainSelectedHanja").textContent = `(${selectedItem.hanja})`;
      document.getElementById("explainSelectedCategory").textContent = selectedItem.category;
      document.getElementById("explainSelectedMeaning").textContent =
        `선택하신 [${selectedItem.word}(${selectedItem.hanja})]은(는) “${selectedItem.meaning}”라는 뜻의 사자성어입니다.`;
    } else {
      wrongDetailBox.classList.add("hidden");
    }

    // 3) 함께 출제된 나머지 보기 사자성어 뜻 비교 리스트
    const otherListEl = document.getElementById("otherOptionsList");
    otherListEl.innerHTML = "";
    currentQ.choices.forEach((choice) => {
      if (choice.id === target.id) return;
      if (!isCorrect && choice.id === selectedItem.id) return; // 이미 위 오답 박스에서 상세 설명됨

      const li = document.createElement("li");
      li.innerHTML = `<strong>${choice.word}(${choice.hanja})</strong>: ${choice.meaning}`;
      otherListEl.appendChild(li);
    });

    // 다음 문제 버튼 문구 설정
    const nextBtn = document.getElementById("nextQuestionBtn");
    const isLast = state.quizSession.currentIndex + 1 >= state.quizSession.questions.length;
    nextBtn.textContent = isLast ? "🏁 퀴즈 결과 및 점수 확인하기" : "다음 문제로 넘어가기 ➡️";

    feedbackPanel.classList.remove("hidden");
    feedbackPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
      msgEl.textContent = "출제된 모든 사자성어의 음과 뜻을 완벽하게 꿰뚫고 계십니다. 정말 대단하십니다!";
    } else if (score >= 80) {
      medalEl.textContent = "🏆";
      titleEl.textContent = "참 잘하셨습니다! 훌륭한 실력이십니다!";
      msgEl.textContent = "대부분의 사자성어를 정확히 알고 계십니다. 아쉽게 틀린 몇 문제만 오답노트에서 가볍게 복습해 보세요.";
    } else if (score >= 50) {
      medalEl.textContent = "👏";
      titleEl.textContent = "수고하셨습니다! 꾸준히 실력이 늘고 있습니다!";
      msgEl.textContent = "헷갈렸던 사자성어들이 오답노트에 잘 정리되어 있습니다. 한 번 더 복습하면 금방 내 것이 됩니다!";
    } else {
      medalEl.textContent = "🌱";
      titleEl.textContent = "좋은 시작입니다! 이제부터 하나씩 익혀 보세요!";
      msgEl.textContent = "천 리 길도 한 걸음부터입니다. 오답노트에 기록된 단어들을 천천히 읽어보며 다시 도전해 보세요!";
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
    renderDictionary();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ==========================================================================
  // 9. 완벽한 오답노트 렌더링 및 관리
  // ==========================================================================
  function renderWrongNoteSection() {
    const grid = document.getElementById("wrongNoteGrid");
    const emptyState = document.getElementById("wrongNoteEmptyState");
    const controlPanel = document.getElementById("wrongQuizControlPanel");
    const toolbar = document.getElementById("wrongnoteToolbar");

    const wrongIds = Object.keys(state.wrongNotes).map((id) => Number(id));
    const wrongItems = IDIOMS_DATA.filter((item) => wrongIds.includes(item.id));

    // 많이 틀린 순서로 정렬
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
        renderDictionary();
        showToast(`🎉 축하합니다! [${item.word}] 단어를 완벽히 외워 오답노트에서 졸업했습니다!`);
      });

      fragment.appendChild(card);
    });

    grid.innerHTML = "";
    grid.appendChild(fragment);
  }

  // ==========================================================================
  // 10. 탭 전환 및 이벤트 바인딩
  // ==========================================================================
  function switchTab(tabName, keepQuizView = false) {
    state.activeTab = tabName;

    document.querySelectorAll(".nav-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });

    document.querySelectorAll(".tab-section").forEach((sec) => {
      sec.classList.toggle("active", sec.id === `section-${tabName}`);
    });

    // 퀴즈 탭을 눌렀을 때 진행 중인 퀴즈가 없으면 설정 화면을 보여줌
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
    // 글자 크기 적용
    document.body.classList.remove("font-size-normal", "font-size-large", "font-size-xlarge");
    document.body.classList.add(`font-size-${state.fontSize}`);

    document.querySelectorAll(".font-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.size === state.fontSize);
    });

    // 효과음 토글 적용
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
    // 홈 로고 클릭 시 사전 탭으로
    document.getElementById("brandHomeBtn").addEventListener("click", () => {
      SoundEffects.playClick();
      switchTab("dictionary");
    });

    // 카톡 공유(주소복사) 버튼
    const PUBLIC_GAME_URL = "https://litter.catbox.moe/b4xt3n.html";
    const shareLinkBtn = document.getElementById("shareLinkBtn");
    if (shareLinkBtn) {
      shareLinkBtn.addEventListener("click", async () => {
        SoundEffects.playClick();
        // file:// 로 열었을 때도 항상 실제 작동하는 https:// 공개 주소가 공유되도록 처리
        const targetUrl = window.location.protocol.startsWith("http")
          ? window.location.href
          : PUBLIC_GAME_URL;

        const shareData = {
          title: "📜 초등 사자성어 300 마스터 & 오답노트",
          text: "시니어 맞춤형 큰 글씨 사자성어 300선 사전 & 퀴즈 게임! 아래 주소를 눌러 함께 풀어보세요.",
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
          showToast("📋 카카오톡 공유용 인터넷 주소(https://...)가 복사되었습니다! 채팅방에 붙여넣기 하세요.");
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

    // 오늘의 지혜 새로고침
    document.getElementById("todayRefreshBtn").addEventListener("click", () => {
      SoundEffects.playClick();
      renderRandomTodayIdiom();
    });

    // 사전 검색 입력
    const searchInput = document.getElementById("dictSearchInput");
    const clearBtn = document.getElementById("dictSearchClearBtn");

    searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      clearBtn.classList.toggle("hidden", !state.searchQuery);
      renderDictionary();
    });

    clearBtn.addEventListener("click", () => {
      SoundEffects.playClick();
      state.searchQuery = "";
      searchInput.value = "";
      clearBtn.classList.add("hidden");
      renderDictionary();
      searchInput.focus();
    });

    // 초성 필터
    document.querySelectorAll("#chosungBar .chosung-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        SoundEffects.playClick();
        state.selectedChosung = btn.dataset.chosung;
        document.querySelectorAll("#chosungBar .chosung-btn").forEach((b) => {
          b.classList.toggle("active", b === btn);
        });
        renderDictionary();
      });
    });

    // 학습 상태 필터 칩
    document.querySelectorAll(".status-filter-group .filter-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        SoundEffects.playClick();
        state.statusFilter = chip.dataset.filter;
        document.querySelectorAll(".status-filter-group .filter-chip").forEach((c) => {
          c.classList.toggle("active", c === chip);
        });
        renderDictionary();
      });
    });

    // 뜻 가리고 암기 테스트 토글
    const blindBtn = document.getElementById("toggleBlindMeaningBtn");
    blindBtn.addEventListener("click", () => {
      SoundEffects.playClick();
      state.blindMeaningMode = !state.blindMeaningMode;
      blindBtn.classList.toggle("active", state.blindMeaningMode);
      blindBtn.setAttribute("aria-pressed", String(state.blindMeaningMode));
      blindBtn.textContent = state.blindMeaningMode
        ? "👀 뜻 항상 보이기"
        : "🙈 뜻 가리고 암기 테스트";
      renderDictionary();
      showToast(
        state.blindMeaningMode
          ? "🙈 뜻이 가려졌습니다. 단어 카드의 회색 영역을 누르면 뜻이 나타납니다!"
          : "👀 모든 사자성어의 뜻을 다시 표시합니다."
      );
    });

    // 사전 필터 초기화
    document.getElementById("resetDictFilterBtn").addEventListener("click", () => {
      SoundEffects.playClick();
      state.searchQuery = "";
      state.selectedChosung = "ALL";
      state.statusFilter = "all";
      searchInput.value = "";
      clearBtn.classList.add("hidden");
      document.querySelectorAll("#chosungBar .chosung-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.chosung === "ALL");
      });
      document.querySelectorAll(".status-filter-group .filter-chip").forEach((c) => {
        c.classList.toggle("active", c.dataset.filter === "all");
      });
      renderDictionary();
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

    // 퀴즈 도중 종료 버튼
    document.getElementById("quitQuizBtn").addEventListener("click", () => {
      SoundEffects.playClick();
      state.quizSession.active = false;
      document.getElementById("quizPlayView").classList.add("hidden");
      document.getElementById("quizSetupView").classList.remove("hidden");
    });

    // 다음 문제 버튼
    document.getElementById("nextQuestionBtn").addEventListener("click", goToNextQuestion);

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
        renderDictionary();
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
  // 11. 앱 초기화
  // ==========================================================================
  function init() {
    loadPersistedData();
    applySettingsUI();
    updateBadgesAndCounters();
    renderRandomTodayIdiom();
    renderDictionary();
    renderWrongNoteSection();
    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
