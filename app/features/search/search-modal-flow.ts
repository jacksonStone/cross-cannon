export type SearchModalFlowState = {
  focusedId: string | null;
  isOpen: boolean;
};

export type SearchModalFlowAction =
  | {
    type: "close";
  }
  | {
    type: "open";
  }
  | {
    focusedId: string | null;
    type: "set-focused";
  }
  | {
    focusedId: string;
    type: "similar-results";
  }
  | {
    focusedId: string;
    type: "submitting-similar";
  }
  | {
    type: "theme-results";
  };

export const initialSearchModalFlowState: SearchModalFlowState = {
  focusedId: null,
  isOpen: false
};

export function searchModalFlowReducer(
  state: SearchModalFlowState,
  action: SearchModalFlowAction
): SearchModalFlowState {
  switch (action.type) {
    case "close":
      return {
        ...state,
        isOpen: false
      };
    case "open":
      return {
        ...state,
        isOpen: true
      };
    case "set-focused":
      return {
        ...state,
        focusedId: action.focusedId
      };
    case "similar-results":
    case "submitting-similar":
      return {
        focusedId: action.focusedId,
        isOpen: true
      };
    case "theme-results":
      return {
        focusedId: null,
        isOpen: true
      };
    default:
      return state;
  }
}
