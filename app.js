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
  const logoutBtn = document.getElementById("logoutBtn");
  const evalImageStage = document.getElementById("evalImageStage");
  const evalImageFrame = document.getElementById("evalImageFrame");
  const imgZoomLens = document.getElementById("imgZoomLens");
  const imgZoomResult = document.getElementById("imgZoomResult");
  const studentEvalImageStatus = document.getElementById(
    "studentEvalImageStatus"
  );

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
  /** 빠른 인덱스 전환 시 이전 로드 콜백 무시 */
  let studentEvalImageLoadToken = 0;
  /** 세션의 targetClass (평가 중·종료 후 스냅샷 동기화, 누적 경로 키용) */
  let lastTargetClass = "";

  function firebaseSafeKeySegment(raw) {
    return String(raw || "")
      .trim()
      .replace(/[.#$\[\]/\u0000-\u001F]/g, "_");
  }

  const ZOOM_LEVEL = 3;
  const zoomState = {
    rafId: null,
    resizeObserver: null,
    onStageMove: null,
    onStageLeave: null,
    onTouchStart: null,
    onTouchEnd: null,
    touchClearTimer: null,
  };

  function setEvalModeActive(on) {
    document.body.classList.toggle("page--eval-active", !!on);
  }

  function detachImageZoom() {
    if (zoomState.touchClearTimer) {
      clearTimeout(zoomState.touchClearTimer);
      zoomState.touchClearTimer = null;
    }
    if (zoomState.rafId) {
      cancelAnimationFrame(zoomState.rafId);
      zoomState.rafId = null;
    }
    if (zoomState.resizeObserver && evalImageFrame) {
      zoomState.resizeObserver.disconnect();
      zoomState.resizeObserver = null;
    }
    if (evalImageStage) {
      evalImageStage.classList.remove("is-zoom-active");
      if (zoomState.onStageMove) {
        evalImageStage.removeEventListener("mousemove", zoomState.onStageMove);
        evalImageStage.removeEventListener("touchmove", zoomState.onStageMove);
      }
      if (zoomState.onStageLeave) {
        evalImageStage.removeEventListener("mouseleave", zoomState.onStageLeave);
      }
      if (zoomState.onTouchStart) {
        evalImageStage.removeEventListener("touchstart", zoomState.onTouchStart);
      }
      if (zoomState.onTouchEnd) {
        evalImageStage.removeEventListener("touchend", zoomState.onTouchEnd);
        evalImageStage.removeEventListener("touchcancel", zoomState.onTouchEnd);
      }
    }
    zoomState.onStageMove = null;
    zoomState.onStageLeave = null;
    zoomState.onTouchStart = null;
    zoomState.onTouchEnd = null;
    if (imgZoomLens) {
      imgZoomLens.hidden = true;
    }
    if (imgZoomResult) {
      imgZoomResult.hidden = true;
      imgZoomResult.style.backgroundImage = "";
      imgZoomResult.style.backgroundSize = "";
      imgZoomResult.style.backgroundPosition = "";
    }
  }

  function syncZoomBackgroundSize() {
    if (!evalImageFrame || !imgZoomResult) {
      return;
    }
    const fw = evalImageFrame.offsetWidth;
    const fh = evalImageFrame.offsetHeight;
    if (fw < 8 || fh < 8) {
      return;
    }
    imgZoomResult.style.backgroundSize =
      fw * ZOOM_LEVEL + "px " + fh * ZOOM_LEVEL + "px";
  }

  function applyZoomAtClientPoint(clientX, clientY) {
    if (!evalImageFrame || !imgZoomLens || !imgZoomResult) {
      return;
    }
    const rect = evalImageFrame.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const fw = rect.width;
    const fh = rect.height;
    if (fw < 8 || fh < 8) {
      return;
    }
    if (px < 0 || py < 0 || px > fw || py > fh) {
      imgZoomLens.hidden = true;
      return;
    }
    const lens = Math.round(
      Math.min(104, Math.max(56, Math.min(fw, fh) * 0.17))
    );
    let lx = px - lens / 2;
    let ly = py - lens / 2;
    lx = Math.max(0, Math.min(lx, fw - lens));
    ly = Math.max(0, Math.min(ly, fh - lens));
    imgZoomLens.style.width = lens + "px";
    imgZoomLens.style.height = lens + "px";
    imgZoomLens.style.left = lx + "px";
    imgZoomLens.style.top = ly + "px";
    imgZoomLens.hidden = false;
    const rw = imgZoomResult.offsetWidth || 1;
    const rh = imgZoomResult.offsetHeight || 1;
    const bgX = -lx * ZOOM_LEVEL + rw / 2 - (lens * ZOOM_LEVEL) / 2;
    const bgY = -ly * ZOOM_LEVEL + rh / 2 - (lens * ZOOM_LEVEL) / 2;
    imgZoomResult.style.backgroundPosition = bgX + "px " + bgY + "px";
  }

  function scheduleZoomMove(clientX, clientY) {
    if (zoomState.rafId) {
      cancelAnimationFrame(zoomState.rafId);
    }
    zoomState.rafId = requestAnimationFrame(function () {
      zoomState.rafId = null;
      applyZoomAtClientPoint(clientX, clientY);
    });
  }

  function attachImageZoom() {
    detachImageZoom();
    if (
      !evalImageStage ||
      !evalImageFrame ||
      !studentEvalImage ||
      !imgZoomLens ||
      !imgZoomResult
    ) {
      return;
    }
    if (!studentEvalImage.src) {
      return;
    }
    const src = studentEvalImage.currentSrc || studentEvalImage.src;
    imgZoomResult.style.backgroundImage =
      'url("' + src.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '")';
    imgZoomResult.hidden = false;
    syncZoomBackgroundSize();

    zoomState.onStageMove = function (e) {
      if (evalPanel.hidden) {
        return;
      }
      const t = e.touches ? e.touches[0] : e;
      if (!t) {
        return;
      }
      scheduleZoomMove(t.clientX, t.clientY);
    };
    zoomState.onStageLeave = function () {
      if (imgZoomLens) {
        imgZoomLens.hidden = true;
      }
    };
    zoomState.onTouchStart = function (e) {
      evalImageStage.classList.add("is-zoom-active");
      zoomState.onStageMove(e);
    };
    zoomState.onTouchEnd = function () {
      if (zoomState.touchClearTimer) {
        clearTimeout(zoomState.touchClearTimer);
      }
      zoomState.touchClearTimer = setTimeout(function () {
        evalImageStage.classList.remove("is-zoom-active");
        if (imgZoomLens) {
          imgZoomLens.hidden = true;
        }
        zoomState.touchClearTimer = null;
      }, 240);
    };

    evalImageStage.addEventListener("mousemove", zoomState.onStageMove);
    evalImageStage.addEventListener("touchmove", zoomState.onStageMove, {
      passive: true,
    });
    evalImageStage.addEventListener("mouseleave", zoomState.onStageLeave);
    evalImageStage.addEventListener("touchstart", zoomState.onTouchStart, {
      passive: true,
    });
    evalImageStage.addEventListener("touchend", zoomState.onTouchEnd);
    evalImageStage.addEventListener("touchcancel", zoomState.onTouchEnd);

    if (typeof ResizeObserver !== "undefined") {
      zoomState.resizeObserver = new ResizeObserver(function () {
        syncZoomBackgroundSize();
      });
      zoomState.resizeObserver.observe(evalImageFrame);
    }

    var r = evalImageFrame.getBoundingClientRect();
    scheduleZoomMove(r.left + r.width / 2, r.top + r.height / 2);
  }

  function queueImageZoomAfterHeroLoad() {
    function tryAttach() {
      if (evalPanel.hidden) {
        return;
      }
      attachImageZoom();
    }
    if (studentEvalImage.src && studentEvalImage.complete && studentEvalImage.naturalWidth) {
      requestAnimationFrame(tryAttach);
      return;
    }
    studentEvalImage.addEventListener(
      "load",
      function () {
        requestAnimationFrame(tryAttach);
      },
      { once: true }
    );
    studentEvalImage.addEventListener(
      "error",
      function () {
        detachImageZoom();
      },
      { once: true }
    );
  }

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
    setEvalModeActive(false);
    detachImageZoom();
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
    setEvalModeActive(false);
    detachImageZoom();
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
    setEvalModeActive(true);
    studentPageTitle.textContent = "작품 평가";
    studentPageSubtitle.textContent =
      "슬라이더로 점수를 선택한 뒤 제출해 주세요.";
    if (studentFooterHint) {
      studentFooterHint.hidden = true;
    }
  }

  function showFinishedPanel() {
    setEvalModeActive(false);
    detachImageZoom();
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

  function setStudentEvalImageStatus(message) {
    if (!studentEvalImageStatus) {
      return;
    }
    if (message) {
      studentEvalImageStatus.textContent = message;
      studentEvalImageStatus.hidden = false;
    } else {
      studentEvalImageStatus.textContent = "";
      studentEvalImageStatus.hidden = true;
    }
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
    detachImageZoom();
    const tc = (targetClass || "").trim();
    const ci = Number(index) || 1;
    const token = ++studentEvalImageLoadToken;

    if (!tc) {
      studentEvalImage.onload = null;
      studentEvalImage.onerror = null;
      studentEvalImage.removeAttribute("src");
      studentEvalImage.alt = "대기 중";
      studentEvalImage.classList.remove("eval-image--loading");
      setStudentEvalImageStatus("");
      return;
    }

    const url = imageUrlFor(tc, ci);
    if (!url) {
      return;
    }

    studentEvalImage.onload = null;
    studentEvalImage.onerror = null;
    studentEvalImage.classList.add("eval-image--loading");
    studentEvalImage.alt = "불러오는 중… (" + tc + " · " + ci + "번)";
    setStudentEvalImageStatus("이미지를 불러오는 중…");

    function onLoad() {
      if (token !== studentEvalImageLoadToken) {
        return;
      }
      studentEvalImage.onload = null;
      studentEvalImage.onerror = null;
      setStudentEvalImageStatus("");
      studentEvalImage.classList.remove("eval-image--loading");
      studentEvalImage.alt = "평가할 작품: " + tc + " (" + ci + ")";
      queueImageZoomAfterHeroLoad();
    }

    function onError() {
      if (token !== studentEvalImageLoadToken) {
        return;
      }
      studentEvalImage.onload = null;
      studentEvalImage.onerror = null;
      studentEvalImage.classList.remove("eval-image--loading");
      studentEvalImage.removeAttribute("src");
      studentEvalImage.alt = "이미지를 불러올 수 없음";
      setStudentEvalImageStatus(
        "이미지를 불러올 수 없습니다. img/" +
          tc +
          "_img_" +
          ci +
          ".jpg 파일이 있는지 확인해 주세요."
      );
    }

    studentEvalImage.onload = onLoad;
    studentEvalImage.onerror = onError;
    studentEvalImage.src = url;
    if (studentEvalImage.complete && studentEvalImage.naturalWidth) {
      studentEvalImage.onload = null;
      studentEvalImage.onerror = null;
      onLoad();
    }
  }

  function preloadNextImage(targetClass, currentIndex) {
    const tc = (targetClass || "").trim();
    const ci = Number(currentIndex) || 1;
    if (!tc) {
      return;
    }
    const key = tc + "|" + ci;
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
          return null;
        }
        const safeClass = firebaseSafeKeySegment(lastTargetClass);
        if (!safeClass) {
          scoreSlider.value = "5";
          scoreValue.textContent = "5";
          applyPendingState();
          return null;
        }
        return db
          .ref(
            "evaluationResults/" +
              safeClass +
              "/" +
              index +
              "/" +
              sid
          )
          .once("value");
      })
      .then(function (snap2) {
        if (!snap2 || typeof snap2.exists !== "function") {
          return;
        }
        if (snap2.exists()) {
          const prev = snap2.val();
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
    const savedName = localStorage.getItem(LS_NAME);
    const sid = getStudentId();
    const serverPin = s.pin != null ? String(s.pin) : null;
    return !!(
      savedPin &&
      savedName &&
      sid &&
      serverPin != null &&
      String(savedPin) === String(serverPin)
    );
  }

  function logoutStudent() {
    if (
      !confirm(
        "이 기기에 저장된 입장 정보(PIN·닉네임)를 지우고 로그아웃할까요?"
      )
    ) {
      return;
    }
    localStorage.removeItem(LS_NAME);
    localStorage.removeItem(LS_ID);
    localStorage.removeItem(LS_PIN);
    setEvalModeActive(false);
    detachImageZoom();
    wasEvaluating = false;
    prevEvalIndex = null;
    lastPreloadKey = "";
    pinInput.value = "";
    nameInput.value = "";
    sessionRef
      .once("value")
      .then(function (snap) {
        syncSessionUI(snap.val() || {});
      })
      .catch(function (err) {
        console.error(err);
        showLobbyJoin();
        resetEvalControls();
      });
  }

  function syncSessionUI(s) {
    const st = s.status || "lobby";
    const reconnected = canReconnectWithStoredPin(s);

    lastTargetClass = (s.targetClass || "").trim();

    if (st === "evaluating") {
      const idx = Number(s.currentIndex) || 1;
      currentIndex = idx;
      showEvalPanel();
      updateEvalImage(s.targetClass, currentIndex);
      preloadNextImage(s.targetClass, currentIndex);

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

    const safeClass = firebaseSafeKeySegment(lastTargetClass);
    const updates = {};
    updates["currentSession/votes/" + currentIndex + "/" + sid] = score;
    if (safeClass) {
      updates[
        "evaluationResults/" +
          safeClass +
          "/" +
          currentIndex +
          "/" +
          sid
      ] = score;
    }

    db
      .ref()
      .update(updates)
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

  if (logoutBtn) {
    logoutBtn.addEventListener("click", logoutStudent);
  }

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
