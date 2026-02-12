(function() {
    'use strict';

    // State
    let selectedFaceId = null;
    let selectedPartId = null;
    let currentSelection = null;  // Full selection object for highlighting
    let selectionRequestCounter = 0;

    // DOM elements
    const instruction = document.getElementById('instruction');
    const buttonGroup = document.getElementById('buttonGroup');
    const sendBtn = document.getElementById('sendToPenguinCAM');
    const multilayerCheckbox = document.getElementById('multilayerMode');
    const modeLabel = document.getElementById('modeLabel');
    const modeHint = document.getElementById('modeHint');

    // Onshape context from template
    const context = window.ONSHAPE_CONTEXT;

    /**
     * Request a face selection from Onshape
     * This is called on initialization and after each successful selection
     * to create a continuous loop of selection requests
     */
    function requestFaceSelection() {
        selectionRequestCounter++;
        const selectionMessage = {
            messageName: 'requestSelection',
            messageId: 'penguincam-selection-' + selectionRequestCounter,
            documentId: context.documentId,
            workspaceId: context.workspaceId,
            elementId: context.elementId,
            filterType: 'simple',
            entityTypeSpecifier: ['FACE'],      // Only faces
            bodyTypeSpecifier: ['SOLID'],       // Only from solid bodies (not drawings)
            requiredSelectionCount: 1           // Exactly one face
        };
        window.parent.postMessage(selectionMessage, '*');
        console.log('Requested face selection:', selectionMessage);
    }

    /**
     * Initialize the extension
     * Send applicationInit message to Onshape
     */
    function initialize() {
        console.log('PenguinCAM panel initializing...', context);

        // Send initialization message to Onshape
        const initMessage = {
            messageName: 'applicationInit',
            documentId: context.documentId,
            workspaceId: context.workspaceId,
            elementId: context.elementId
        };

        window.parent.postMessage(initMessage, '*');
        console.log('Sent applicationInit:', initMessage);

        // Listen for messages from Onshape
        window.addEventListener('message', handleMessage);

        // Request initial face selection
        // This will be called again after each successful selection
        requestFaceSelection();

        // Set up button handlers
        sendBtn.addEventListener('click', handleSendToPenguinCAM);

        // Set up mode checkbox handler
        multilayerCheckbox.addEventListener('change', updateModeInstructions);

        // Initialize mode instructions
        updateModeInstructions();
    }

    /**
     * Update instruction text based on multilayer mode
     */
    function updateModeInstructions() {
        const isMultilayer = multilayerCheckbox.checked;

        if (isMultilayer) {
            // 2.5D mode - stock must match CAD
            modeLabel.textContent = 'Multi-layer (2.5D) mode';
            modeHint.textContent = 'Stock thickness must match CAD part thickness';
            // Update instruction if no face selected
            if (!selectedFaceId && instruction.style.display !== 'none') {
                instruction.innerHTML = 'Select a face at the <strong>top-most layer</strong> of your part';
                instruction.style.color = '';
            }
        } else {
            // 2D mode - any stock works
            modeLabel.textContent = 'Single-layer (2D) mode';
            modeHint.textContent = 'Any stock thickness works - cutting a flat pattern only';
            // Update instruction if no face selected
            if (!selectedFaceId && instruction.style.display !== 'none') {
                instruction.innerHTML = 'Select the <strong>top face</strong> of your part';
                instruction.style.color = '';
            }
        }
    }

    /**
     * Handle incoming messages from Onshape parent window
     */
    function handleMessage(event) {
        // Validate origin for security
        if (!event.origin.includes('onshape.com')) {
            console.warn('Message from invalid origin:', event.origin);
            return;
        }

        const data = event.data;
        console.log('Received message:', data);

        if (data.messageName === 'REQUESTED_SELECTION') {
            handleRequestedSelection(data);
        }
    }

    /**
     * Request highlighting of the current selection
     * This keeps the selected face visually highlighted while waiting for next selection
     */
    function highlightCurrentSelection() {
        if (!currentSelection) return;

        const highlightMessage = {
            messageName: 'requestSelectionHighlight',
            messageId: 'penguincam-highlight-' + Date.now(),
            documentId: context.documentId,
            workspaceId: context.workspaceId,
            elementId: context.elementId,
            selections: [
                {
                    selectionType: currentSelection.selectionType,
                    selectionId: currentSelection.selectionId,
                    entityType: currentSelection.entityType,
                    workspaceMicroversionId: currentSelection.workspaceMicroversionId
                }
            ]
        };
        window.parent.postMessage(highlightMessage, '*');
        console.log('Requested highlight for current selection:', highlightMessage);
    }

    /**
     * Handle requested selection response from Onshape
     */
    function handleRequestedSelection(data) {
        const selections = data.selections || [];
        const status = data.status || {};
        console.log('Requested selection response:', selections, 'Status:', status);

        // Check status code
        if (status.statusCode === 'SUCCESS' && selections.length > 0) {
            // User successfully selected a face
            const faceSelection = selections[0];

            selectedFaceId = faceSelection.selectionId;
            selectedPartId = faceSelection.partId || null;
            currentSelection = faceSelection;  // Store full selection for highlighting

            // Update UI - hide instruction, show button
            instruction.style.display = 'none';
            buttonGroup.style.display = 'flex';
            sendBtn.disabled = false;

            console.log('✓ Face selected:', selectedFaceId, 'Part:', selectedPartId, 'Full selection:', faceSelection);

            // Immediately request another selection so user can change their mind
            // This creates a continuous loop where we're always ready for the next face
            requestFaceSelection();
        } else if (status.statusCode === 'PENDING') {
            // Still waiting for selection - keep current state if we have one
            if (currentSelection) {
                // We already have a selection - highlight it so user knows what's selected
                highlightCurrentSelection();
            } else {
                // No selection yet - show instruction
                instruction.innerHTML = 'Select a face to export';
                instruction.style.color = '';
                instruction.style.display = 'block';
                buttonGroup.style.display = 'none';
                sendBtn.disabled = true;
            }
        } else {
            // No valid selection or cancelled
            selectedFaceId = null;
            selectedPartId = null;
            currentSelection = null;
            buttonGroup.style.display = 'none';
            sendBtn.disabled = true;
            instruction.innerHTML = 'Select a face to export';
            instruction.style.color = '';
            instruction.style.display = 'block';
        }
    }

    /**
     * Build URL with Onshape context parameters
     */
    function buildUrl(endpoint) {
        const params = new URLSearchParams({
            documentId: context.documentId,
            workspaceId: context.workspaceId,
            elementId: context.elementId,
            server: context.server
        });

        // Add face ID if selected
        if (selectedFaceId) {
            params.append('faceId', selectedFaceId);
        }

        // Add part ID if available
        if (selectedPartId) {
            params.append('partId', selectedPartId);
        }

        // Add multilayer mode
        const isMultilayer = multilayerCheckbox.checked;
        params.append('multilayer', isMultilayer ? 'true' : 'false');

        return `${context.baseUrl}${endpoint}?${params.toString()}`;
    }

    /**
     * Handle "Send to PenguinCAM" button
     * Opens full PenguinCAM interface in new window
     */
    function handleSendToPenguinCAM() {
        const url = buildUrl('/onshape/import');
        console.log('Opening PenguinCAM:', url);

        // Open in new tab (without window features to make it a tab, not popup)
        window.open(url, '_blank');
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
