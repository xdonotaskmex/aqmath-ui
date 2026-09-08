// ============================================================================
// app-tour.js — Interactive Product Tour (Driver.js)
//
// Step-by-step spotlight walkthrough of the /app page. Auto-launches once
// after the user acknowledges "How AQMath Works"; can be re-launched manually
// via the "take the tour" button in the sidebar.
//
// Depends on: driver.js (vendored in /vendor/driver.min.js)
// ============================================================================
(function () {
    'use strict';

    var TOUR_FLAG = 'aqmath_tour_done';
    var _tourActive = false; // re-entry guard

    // -----------------------------------------------------------------------
    // Tour step definitions — each targets a real DOM element on the /app page.
    // If an element is missing or hidden the step is silently skipped,
    // UNLESS it has `alwaysShow: true` (element is temporarily revealed).
    // -----------------------------------------------------------------------
    var STEPS = [
        {
            element: '.hdr',
            popover: {
                title: 'Welcome to AQMath',
                description: 'Your non-custodial portfolio rebalancer. Let\u2019s take a 60-second tour of how it works.',
                side: 'bottom',
                align: 'center'
            }
        },
        {
            element: '#iBetaKey',
            popover: {
                title: 'Unlock Black',
                description: 'Enter your Black activation key here to unlock the full Risk Parity engine, Deleverage Shield and the data pipeline.',
                side: 'right',
                align: 'start'
            }
        },
        {
            element: '.shield-card',
            popover: {
                title: 'Shield Signals',
                description: 'Sync your portfolio to receive daily deleverage signals. Enable push notifications to stay informed on every regime change.',
                side: 'right',
                align: 'start'
            }
        },
        {
            element: '#iSym',
            popover: {
                title: 'Add Your Tokens',
                description: 'Start by adding your crypto positions. Enter a symbol, quantity, and target allocation \u2014 the engine handles the rest.',
                side: 'right',
                align: 'start'
            }
        },
        {
            element: '.hdr-right',
            popover: {
                title: 'Import & Export',
                description: 'SYNC fetches live prices. CSV IMPORT loads transactions, EXPORT saves your portfolio as JSON, IMPORT restores it. RESET clears everything.',
                side: 'bottom',
                align: 'end'
            }
        },
        {
            element: '.chart-wrap',
            popover: {
                title: 'Allocation Overview',
                description: 'This chart shows your current allocation vs targets. The center displays your portfolio coefficient of variation.',
                side: 'left',
                align: 'start'
            }
        },
        {
            element: '#tblWrap',
            popover: {
                title: 'Holdings & Rebalance Engine',
                description: 'Every token here is tracked in real-time. Drift, P&L, and rebalance needs are calculated automatically.',
                side: 'left',
                align: 'start'
            }
        },
        {
            element: '#btnDca',
            popover: {
                title: 'DCA Distribution',
                description: 'Enter a budget and the engine allocates it to underweight tokens \u2014 filtered by volatility and trend.',
                side: 'left',
                align: 'center'
            }
        },
        {
            element: '#btnEngine',
            popover: {
                title: 'Risk Parity Engine',
                description: 'Runs 180-day covariance analysis and KKT projection to compute optimal weights. Institutional-grade math.',
                side: 'left',
                align: 'center'
            }
        },
        {
            element: '#shToggleRow',
            popover: {
                title: 'Safe-Haven (USDC)',
                description: 'When ON, surplus flows to USDC as a stablecoin buffer. An extra layer of downside protection.',
                side: 'right',
                align: 'start'
            }
        },
        {
            element: '#disciplineCard',
            popover: {
                title: 'Discipline Meter',
                description: 'Track your signal confirmation rate. Set a same-day goal and build consistency \u2014 your score decays if signals are missed.',
                side: 'left',
                align: 'start'
            }
        },
        {
            element: '#chatFab',
            alwaysShow: true,
            popover: {
                title: 'Internal Chat',
                description: 'Connect with other Black users. Share insights, ask questions \u2014 pseudonymous, last 20 messages visible to all.',
                side: 'left',
                align: 'end'
            }
        }
    ];

    // -----------------------------------------------------------------------
    // Filter out steps whose target element doesn't exist or is hidden.
    // Steps with `alwaysShow: true` are temporarily revealed for the tour.
    // -----------------------------------------------------------------------
    var _revealedEls = [];

    function availableSteps() {
        _revealedEls = [];
        return STEPS.filter(function (step) {
            if (!step.element) return true;
            var el = document.querySelector(step.element);
            if (!el) return false;
            var style = window.getComputedStyle(el);
            var isHidden = (style.display === 'none' || style.visibility === 'hidden' || el.classList.contains('hidden'));
            if (isHidden && step.alwaysShow) {
                // Temporarily reveal for the tour
                el.classList.remove('hidden');
                el.style.display = '';
                _revealedEls.push(el);
                return true;
            }
            if (isHidden) return false;
            return true;
        });
    }

    function restoreHiddenEls() {
        _revealedEls.forEach(function (el) {
            el.classList.add('hidden');
        });
        _revealedEls = [];
    }

    // -----------------------------------------------------------------------
    // Public: start the product tour.
    // -----------------------------------------------------------------------
    function startProductTour() {
        // Re-entry guard: prevent double-launch
        if (_tourActive) return;

        // Driver.js IIFE exports as window.driver.js.driver (namespace chain)
        var driverFn = (window.driver && window.driver.js && typeof window.driver.js.driver === 'function')
            ? window.driver.js.driver : null;
        if (!driverFn) {
            console.warn('[AQMath Tour] Driver.js not loaded — window.driver:', window.driver);
            return;
        }

        var steps = availableSteps();
        console.log('[AQMath Tour] Starting tour with', steps.length, 'steps');
        if (steps.length === 0) {
            console.warn('[AQMath Tour] No tour steps available on this page.');
            restoreHiddenEls();
            return;
        }

        _tourActive = true;

        var driverObj = driverFn({
            showProgress: true,
            animate: true,
            smoothScroll: true,
            stagePadding: 6,
            stageRadius: 6,
            overlayColor: '#02050d',
            overlayOpacity: 0.75,
            popoverClass: 'aqmath-tour-popover',
            progressText: '{{current}} / {{total}}',
            nextBtnText: 'next',
            prevBtnText: 'prev',
            doneBtnText: 'done',
            onCloseClick: function () {
                localStorage.setItem(TOUR_FLAG, '1');
                driverObj.destroy();
            },
            onDestroyStarted: function () {
                localStorage.setItem(TOUR_FLAG, '1');
                _tourActive = false;
                restoreHiddenEls();
                driverObj.destroy();
            },
            steps: steps
        });

        driverObj.drive();
    }

    // -----------------------------------------------------------------------
    // Auto-launch: on /app, if the tour hasn't been seen yet, start it after
    // a short delay so the page has time to render dynamic content.
    // Called from app-boot.js after ackHowAqmath or on first /app load.
    // -----------------------------------------------------------------------
    function maybeAutoTour() {
        // Only on /app
        if (location.pathname !== '/app') return;
        // Already seen
        if (localStorage.getItem(TOUR_FLAG)) return;
        // Driver.js must be loaded (IIFE exports as window.driver.js.driver)
        if (!(window.driver && window.driver.js && window.driver.js.driver)) return;

        // Wait for dynamic sidebar state to settle (beta check, signal load)
        setTimeout(function () {
            startProductTour();
        }, 1500);
    }

    // Expose globally so app-boot.js can call it
    window.startProductTour = startProductTour;
    window.maybeAutoTour = maybeAutoTour;
})();
