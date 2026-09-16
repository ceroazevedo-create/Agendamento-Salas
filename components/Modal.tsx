import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        {/* Backdrop Overlay */}
        <div 
          className="fixed inset-0 bg-gray-900/60 backdrop-blur-xs transition-opacity animate-fade-in" 
          aria-hidden="true" 
          onClick={onClose}
        ></div>

        <div className="relative inline-block align-bottom bg-white rounded-3xl text-left shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg w-full p-6 sm:p-8 animate-slide-up border border-gray-100">
          <div className="flex justify-between items-center mb-5 pb-3 border-b border-gray-100">
            <h3 className="text-lg font-black text-gray-900 tracking-tight" id="modal-title">
              {title}
            </h3>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-all"
            >
              <X size={18} />
            </button>
          </div>
          <div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};
