(function () {
  const form = document.getElementById("joinForm");
  const pinInput = document.getElementById("pinInput");
  const nameInput = document.getElementById("nameInput");
  const joinBtn = document.getElementById("joinBtn");
  const lobbyPanel = document.getElementById("lobbyPanel");
  const waitPanel = document.getElementById("waitPanel");
  const evalPanel = document.getElementById("evalPanel");
  const finishedPanel = document.getElementById("finishedPanel");
  const studentEvalImage = document.getElementById("studentEvalImage");
  const scoreSlider = document.getElementById("scoreSlider");
  const scoreValue = document.getElementById("scoreValue");
  const submitVoteBtn = document.getElementById("submitVoteBtn");
  const voteStatusMsg = document.getElementById("voteStatusMsg");
  const studentPageTitle = document.getElementById("studentPageTitle");
  const studentPageSubtitle = document.getElementById("studentPageSubtitle");
  const studentFooterHint = document.getElementById("studentFooterHint");

  const LS_NAME = "studentDisplayName";
  const LS_ID = "studentId";
  const LS_PIN = "studentPin";

  const db = firebase.database();
  const pinRef = db.ref("currentSession/pin");
  const usersRef = db.ref("currentSession/users");
  const sessionRef = db.ref("currentSession");

  let currentIndex = 1;
  let wasEvaluating = false;
  let prevEvalIndex = null;
  let lastPreloadKey = "";

  function getStudentId() {
    return localStorage.getItem(LS_ID);
  }

  function hideAllPanels() {
    [
      lobbyPanel,
      waitPanel,
      evalPanel,
      finishedPanel,
    ].forEach(function (el) {
      if (!el) {
        return;
      }
      el.hidden = true;
      el.classList.add("panel--hidden");
    });
  }

  function showLobbyJoin() {
    hideAllPanels();
    lobbyPanel.hidden = false;
    lobbyPanel.classList.remove("panel--hidden");
    studentPageTitle.textContent = "세션 입장";
    studentPageSubtitle.textContent =
      "관리자가 알려 준 PIN과 학번 또는 닉네임을 입력하세요.";
    if (studentFooterHint) {
      studentFooterHint.hidden = false;
    }
  }

  function showWaitPanel() {
    hideAllPanels();
    waitPanel.hidden = false;
    waitPanel.classList.remove("panel--hidden");
    studentPageTitle.textContent = "세션 연결됨";
    studentPageSubtitle.textContent =
      "평가가 시작되면 화면이 자동으로 전환됩니다.";
    if (studentFooterHint) {
      studentFooterHint.hidden = true;
    }
  }

  function showEvalPanel() {
    hideAllPanels();
    evalPanel.hidden = false;
    evalPanel.classList.remove("panel--hidden");
    studentPageTitle.textContent = "작품 평가";
    studentPageSubtitle.textContent =
      "슬라이더로 점수를 선택한 뒤 제출해 주세요.";
    if (studentFooterHint) {
      studentFooterHint.hidden = true;
    }
  }

  function showFinishedPanel() {
    hideAllPanels();
    finishedPanel.hidden = false;
    finishedPanel.classList.remove("panel--hidden");
    studentPageTitle.textContent = "평가 종료";
    studentPageSubtitle.textContent = "이번 세션은 종료되었습니다.";
    if (studentFooterHint) {
      studentFooterHint.hidden = true;
    }
  }

  function resetEvalControls() {
    scoreSlider.value = "5";
    scoreValue.textContent = "5";
    submitVoteBtn.disabled = false;
    voteStatusMsg.textContent = "";
  }

  function imageUrlFor(targetClass, index) {
    const tc = (targetClass || "").trim();
    const ci = Number(index) || 1;
    if (!tc) {
      return "";
    }
    return "img/" + tc + "_img_" + ci + ".jpg";
  }

  function updateEvalImage(targetClass, index) {
    const url = imageUrlFor(targetClass, index);
    if (!url) {
      studentEvalImage.removeAttribute("src");
      studentEvalImage.alt = "대기 중";
      return;
    }
    studentEvalImage.src = url;
    studentEvalImage.alt = "평가할 작품: " + (targetClass || "").trim() + " (" + index + ")";
  }

  function preloadNextImage(targetClass, currentIndex, totalImages) {
    const tc = (targetClass || "").trim();
    const ci = Number(currentIndex) || 1;
    const ti = Number(totalImages) || 0;
    if (!tc || ti < 1 || ci >= ti) {
      return;
    }
    const key = tc + "|" + ci + "|" + ti;
    if (key === lastPreloadKey) {
      return;
    }
    lastPreloadKey = key;
    const nextUrl = imageUrlFor(tc, ci + 1);
    if (!nextUrl) {
      return;
    }
    const img = new Image();
    img.src = nextUrl;
  }

  function applySubmittedState() {
    submitVoteBtn.disabled = true;
    voteStatusMsg.textContent = "제출 완료, 대기 중...";
  }

  function applyPendingState() {
    submitVoteBtn.disabled = false;
    voteStatusMsg.textContent = "";
  }

  function checkExistingVote(index) {
    const sid = getStudentId();
    if (!sid) {
      submitVoteBtn.disabled = true;
      voteStatusMsg.textContent =
        "입장 기록이 없습니다. 로비에서 먼저 입장해 주세요.";
      return;
    }

    db.ref("currentSession/votes/" + index + "/" + sid)
      .once("value")
      .then(function (snap) {
        if (snap.exists()) {
          const prev = snap.val();
          if (typeof prev === "number" && prev >= 1 && prev <= 10) {
            scoreSlider.value = String(prev);
            scoreValue.textContent = String(prev);
          }
          applySubmittedState();
        } else {
          scoreSlider.value = "5";
          scoreValue.textContent = "5";
          applyPendingState();
        }
      })
      .catch(function (err) {
        console.error(err);
      });
  }

  function canReconnectWithStoredPin(s) {
    const savedPin = localStorage.getItem(LS_PIN);
    const sid = getStudentId();
    const serverPin = s.pin != null ? String(s.pin) : null;
    return !!(
      savedPin &&
      sid &&
      serverPin != null &&
      String(savedPin) === String(serverPin)
    );
  }

  function syncSessionUI(s) {
    const st = s.status || "lobby";
    const reconnected = canReconnectWithStoredPin(s);

    if (st === "evaluating") {
      const idx = Number(s.currentIndex) || 1;
      currentIndex = idx;
      showEvalPanel();
      updateEvalImage(s.targetClass, currentIndex);
      preloadNextImage(s.targetClass, currentIndex, s.totalImages);

      const indexChanged = !wasEvaluating || prevEvalIndex !== idx;
      wasEvaluating = true;
      prevEvalIndex = idx;
      if (indexChanged) {
        resetEvalControls();
        checkExistingVote(currentIndex);
      }
      return;
    }

    wasEvaluating = false;
    prevEvalIndex = null;

    if (st === "finished") {
      showFinishedPanel();
      return;
    }

    if (reconnected) {
      showWaitPanel();
      return;
    }

    showLobbyJoin();
    resetEvalControls();
  }

  scoreSlider.addEventListener("input", function () {
    scoreValue.textContent = scoreSlider.value;
  });

  submitVoteBtn.addEventListener("click", function () {
    const sid = getStudentId();
    if (!sid) {
      alert("세션에 입장한 뒤에만 제출할 수 있습니다.");
      return;
    }

    const score = Number(scoreSlider.value);
    if (score < 1 || score > 10 || Number.isNaN(score)) {
      alert("1에서 10 사이의 점수를 선택해 주세요.");
      return;
    }

    submitVoteBtn.disabled = true;

    db.ref("currentSession/votes/" + currentIndex + "/" + sid)
      .set(score)
      .then(function () {
        applySubmittedState();
      })
      .catch(function (err) {
        console.error(err);
        alert(
          "제출에 실패했습니다. 네트워크와 Firebase 규칙을 확인해 주세요."
        );
        submitVoteBtn.disabled = false;
      });
  });

  function endBootstrap() {
    document.body.classList.remove("app-bootstrapping");
    document.body.classList.add("app-ready");
  }

  sessionRef
    .once("value")
    .then(function (snap) {
      syncSessionUI(snap.val() || {});
    })
    .finally(function () {
      sessionRef.on("value", function (snap) {
        syncSessionUI(snap.val() || {});
      });
      endBootstrap();
    });

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    const enteredPin = pinInput.value.trim();
    const displayName = nameInput.value.trim();

    if (!/^\d{4}$/.test(enteredPin)) {
      alert("PIN은 4자리 숫자로 입력해 주세요.");
      pinInput.focus();
      return;
    }

    if (!displayName) {
      alert("학번 또는 닉네임을 입력해 주세요.");
      nameInput.focus();
      return;
    }

    joinBtn.disabled = true;

    pinRef
      .once("value")
      .then(function (snapshot) {
        const serverPin = snapshot.val();
        if (serverPin == null || String(serverPin) !== enteredPin) {
          alert("PIN이 일치하지 않습니다. 관리자에게 확인해 주세요.");
          return;
        }

        return usersRef.push({
          displayName: displayName,
          joinedAt: Date.now(),
        });
      })
      .then(function (result) {
        if (result === undefined) {
          return;
        }
        const key = result.key;
        if (key) {
          localStorage.setItem(LS_ID, key);
        }
        localStorage.setItem(LS_NAME, displayName);
        localStorage.setItem(LS_PIN, enteredPin);
        alert("접속에 성공했습니다. 환영합니다!");
        pinInput.value = "";

        return sessionRef.once("value");
      })
      .then(function (sessionSnap) {
        if (!sessionSnap) {
          return;
        }
        const s = sessionSnap.val() || {};
        syncSessionUI(s);
        if (s.status === "evaluating" && getStudentId()) {
          checkExistingVote(Number(s.currentIndex) || 1);
        }
      })
      .catch(function (err) {
        console.error(err);
        alert(
          "연결에 실패했습니다. 네트워크와 Firebase 설정을 확인해 주세요."
        );
      })
      .finally(function () {
        joinBtn.disabled = false;
      });
  });
})();
